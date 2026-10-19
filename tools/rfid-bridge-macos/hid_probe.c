/* RU5600 USB probe. --write-once is gated and writes only EPC bank 1. */
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    uint8_t report[64];
    uint8_t received[4096];
    size_t count;
    int overflowed;
} Probe;

static int number(IOHIDDeviceRef device, CFStringRef key) {
    CFTypeRef value = IOHIDDeviceGetProperty(device, key);
    int result = -1;
    if (value && CFGetTypeID(value) == CFNumberGetTypeID())
        CFNumberGetValue((CFNumberRef)value, kCFNumberIntType, &result);
    return result;
}

static void input_report(void *context, IOReturn result, void *sender,
                         IOHIDReportType type, uint32_t reportID,
                         uint8_t *report, CFIndex reportLength) {
    (void)sender; (void)type; (void)reportID;
    Probe *probe = (Probe *)context;
    if (result != kIOReturnSuccess || reportLength <= 0) return;
    size_t available = sizeof(probe->received) - probe->count;
    size_t copy = (size_t)reportLength < available ? (size_t)reportLength : available;
    if (copy < (size_t)reportLength) probe->overflowed = 1;
    memcpy(probe->received + probe->count, report, copy);
    probe->count += copy;
}

typedef struct {
    /* One 64-byte HID report can contain at most 42 whole EPC bytes here. */
    uint8_t epc[42];
    size_t epcLength;
    int hasEpc;
    int reports;
    int multiple;
    int malformed;
} ActiveScan;

static void collect_active_reports(const Probe *probe, ActiveScan *scan) {
    if (probe->overflowed || probe->count % 64 != 0) scan->malformed = 1;
    for (size_t offset = 0; offset + 64 <= probe->count; offset += 64) {
        const uint8_t *frame = probe->received + offset;
        if (frame[1] != 0x43 || frame[2] != 0x54 || frame[6] != 0x45) continue;
        size_t length = (size_t)frame[0] + 1;
        if (length < 21 || length > 64 || frame[7] != 1) { scan->malformed = 1; continue; }
        unsigned sum = 0;
        for (size_t index = 1; index < length; index++) sum += frame[index];
        if ((sum & 0xFFu) != 0) { scan->malformed = 1; continue; }
        scan->reports++;
        if (frame[15] != 1) { scan->multiple = 1; continue; }
        const size_t packetLength = frame[16];
        const size_t epcLength = packetLength >= 3 ? packetLength - 3 : 0;
        if (epcLength < 2 || epcLength > sizeof(scan->epc) || epcLength % 2 != 0
            || 17 + packetLength != length - 1 || frame[17] != 1) {
            scan->malformed = 1;
            continue;
        }
        const uint8_t *epc = frame + 19;
        if (scan->hasEpc && (scan->epcLength != epcLength || memcmp(scan->epc, epc, epcLength) != 0)) scan->multiple = 1;
        else { memcpy(scan->epc, epc, epcLength); scan->epcLength = epcLength; scan->hasEpc = 1; }
    }
}

static void print_hex(const uint8_t *bytes, size_t count) {
    for (size_t index = 0; index < count; index++) printf("%02X", bytes[index]);
    putchar('\n');
}

static void print_frames(const uint8_t *bytes, size_t count) {
    for (size_t offset = 0; offset < count; offset += 64) {
        size_t available = count - offset;
        size_t frameLength = bytes[offset];
        if (frameLength + 1 > available) frameLength = available - 1;
        printf("  report: ");
        print_hex(bytes + offset, frameLength + 1);
    }
}

/* SDK responses normally arrive well before the one-second timeout. Return
   as soon as the complete checksum-valid frame is available instead of
   sleeping for the whole timeout after every reader command. */
static const uint8_t *wait_frame(Probe *probe, uint8_t operation, size_t frameLength, int timeoutMs) {
    const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + (double)timeoutMs / 1000.0;
    do {
        if (probe->overflowed) return NULL;
        for (size_t offset = 0; offset + frameLength <= probe->count; offset += 64) {
            const uint8_t *frame = probe->received + offset;
            if (frame[0] != frameLength - 1 || frame[1] != 0x43 || frame[2] != 0x54 || frame[6] != operation) continue;
            unsigned sum = 0;
            for (size_t index = 1; index < frameLength; index++) sum += frame[index];
            if ((sum & 0xFFu) == 0) return frame;
        }
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, false);
    } while (CFAbsoluteTimeGetCurrent() < deadline);
    return NULL;
}

static int listen_keyboard(IOHIDDeviceRef device) {
    IOReturn status = IOHIDDeviceOpen(device, kIOHIDOptionsTypeNone);
    printf("Reader keyboard-interface open: 0x%08X\n", status);
    if (status != kIOReturnSuccess) return 0;
    Probe probe = {0};
    IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    IOHIDDeviceRegisterInputReportCallback(device, probe.report, sizeof(probe.report), input_report, &probe);
    puts("Listening only to this reader's keyboard HID interface for 12 seconds. Present one chip now.");
    for (int second = 0; second < 12; second++) {
        probe.count = 0;
        for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
        if (probe.count) {
            printf("Second %d keyboard HID input: ", second + 1);
            print_hex(probe.received, probe.count);
        }
    }
    IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
    return 1;
}

static int read_tag_bank(IOHIDDeviceRef device, Probe *probe, uint8_t bank, uint8_t wordPointer, uint8_t wordLength, uint8_t *data) {
    /* Supplied Linux SDK CFHid_ReadCardG2: command 0x02, bank, word pointer,
       word length, four zero password bytes. This reads; it never writes. */
    uint8_t command[64] = {14, 0x53, 0x57, 0x00, 0x0A, 0xFF, 0x02, bank, wordPointer, wordLength, 0, 0, 0, 0};
    unsigned sum = 0;
    for (size_t index = 1; index < 14; index++) sum += command[index];
    command[14] = (uint8_t)(0u - sum);
    const size_t frameLength = 9u + 2u * wordLength;
    // RU5600 sometimes misses the first TID/EPC-bank response on a stable tag.
    // A third bounded read attempt reduces transient incomplete reads without
    // ever falling back to an EPC-only write authorization.
    for (int attempt = 0; attempt < 3; attempt++) {
        probe->count = 0;
        IOReturn status = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, command, sizeof(command));
        printf("SDK read bank %u, word %u, length %u attempt %d result: 0x%08X\n", bank, wordPointer, wordLength, attempt + 1, status);
        if (status != kIOReturnSuccess) return 0;
        const uint8_t *frame = wait_frame(probe, 0x02, frameLength, 1200);
        print_frames(probe->received, probe->count);
        if (frame && frame[7] == 0x01) {
            memcpy(data, frame + 8, 2u * wordLength);
            return 1;
        }
    }
    return 0;
}

static void read_device_parameter(IOHIDDeviceRef device, Probe *probe, uint8_t parameter, const char *label) {
    /* Supplied Linux SDK CFHid_ReadDeviceOneParam: command 0x23. */
    uint8_t command[64] = {8, 0x53, 0x57, 0x00, 0x04, 0xFF, 0x23, parameter};
    unsigned sum = 0;
    for (size_t index = 1; index < 8; index++) sum += command[index];
    command[8] = (uint8_t)(0u - sum);
    probe->count = 0;
    IOReturn status = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, command, sizeof(command));
    printf("SDK read-only %s parameter result: 0x%08X\n", label, status);
    if (status == kIOReturnSuccess) {
        for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
        print_frames(probe->received, probe->count);
    }
}

static int work_mode_value(IOHIDDeviceRef device, Probe *probe) {
    uint8_t command[64] = {8, 0x53, 0x57, 0x00, 0x04, 0xFF, 0x23, 0x02};
    unsigned sum = 0;
    for (size_t index = 1; index < 8; index++) sum += command[index];
    command[8] = (uint8_t)(0u - sum);
    probe->count = 0;
    if (IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, command, sizeof(command)) != kIOReturnSuccess) return -1;
    const uint8_t *frame = wait_frame(probe, 0x23, 11, 1000);
    if (frame && frame[7] == 1 && frame[8] == 2) return frame[9];
    return -1;
}

static int set_work_mode(IOHIDDeviceRef device, Probe *probe, uint8_t value) {
    /* SDK CFHid_SetDeviceOneParam: command 0x24, parameter 0x02 = work mode. */
    uint8_t command[64] = {9, 0x53, 0x57, 0x00, 0x05, 0xFF, 0x24, 0x02, value};
    unsigned sum = 0;
    for (size_t index = 1; index < 9; index++) sum += command[index];
    command[9] = (uint8_t)(0u - sum);
    probe->count = 0;
    if (IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, command, sizeof(command)) != kIOReturnSuccess) return 0;
    const uint8_t *frame = wait_frame(probe, 0x24, 9, 1000);
    return frame && frame[7] == 1;
}

static int inspect_inventory_in_answer_mode(IOHIDDeviceRef device, Probe *probe) {
    int originalMode = work_mode_value(device, probe);
    if (originalMode < 0 || originalMode > 2) {
        puts("RACEUPSHOT_INVENTORY_JSON:{\"error\":\"Cannot read original work mode; no mode change attempted.\"}");
        return 0;
    }
    printf("Original SDK work mode: %d\n", originalMode);
    if (originalMode != 0) {
        int switched = set_work_mode(device, probe, 0);
        int observed = work_mode_value(device, probe);
        if (!switched || observed != 0) {
            int restored = observed == originalMode || (set_work_mode(device, probe, (uint8_t)originalMode) && work_mode_value(device, probe) == originalMode);
            printf("RACEUPSHOT_INVENTORY_JSON:{\"originalMode\":%d,\"answerMode\":%d,\"restored\":%s,\"error\":\"Answer-mode switch failed; no inventory attempted.\"}\n",
                   originalMode, observed, restored ? "true" : "false");
            return restored;
        }
    }
    int answerMode = work_mode_value(device, probe);
    uint8_t inventory[64] = {10, 0x53, 0x57, 0x00, 0x06, 0xFF, 0x01, 0, 0, 0};
    unsigned sum = 0;
    for (size_t index = 1; index < 10; index++) sum += inventory[index];
    inventory[10] = (uint8_t)(0u - sum);
    probe->count = 0;
    IOReturn sent = answerMode == 0 ? IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, inventory, sizeof(inventory)) : kIOReturnError;
    if (sent == kIOReturnSuccess) {
        for (int index = 0; index < 15; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
        print_frames(probe->received, probe->count);
    }
    int restored = originalMode == 0 || (set_work_mode(device, probe, (uint8_t)originalMode) && work_mode_value(device, probe) == originalMode);
    printf("RACEUPSHOT_INVENTORY_JSON:{\"originalMode\":%d,\"answerMode\":%d,\"commandSent\":%s,\"restored\":%s,\"error\":%s}\n",
           originalMode, answerMode, sent == kIOReturnSuccess ? "true" : "false", restored ? "true" : "false",
           restored ? "null" : "\"Original work mode could not be restored; stop using reader.\"");
    return restored;
}

static int simple_reader_command(IOHIDDeviceRef device, Probe *probe, uint8_t operation) {
    uint8_t command[64] = {7, 0x53, 0x57, 0x00, 0x03, 0xFF, operation};
    unsigned sum = 0;
    for (size_t index = 1; index < 7; index++) sum += command[index];
    command[7] = (uint8_t)(0u - sum);
    probe->count = 0;
    if (IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, command, sizeof(command)) != kIOReturnSuccess) return 0;
    const uint8_t *frame = wait_frame(probe, operation, 9, 1000);
    return frame && frame[7] == 1;
}

static int inspect_active_reports(IOHIDDeviceRef device, Probe *probe) {
    int originalMode = work_mode_value(device, probe);
    if (originalMode < 0 || originalMode > 2) {
        puts("RACEUPSHOT_ACTIVE_JSON:{\"error\":\"Cannot read original work mode; no mode change attempted.\"}");
        return 0;
    }
    int switched = originalMode == 1 || set_work_mode(device, probe, 1);
    int activeMode = work_mode_value(device, probe);
    if (!switched || activeMode != 1) {
        int restored = activeMode == originalMode || (set_work_mode(device, probe, (uint8_t)originalMode) && work_mode_value(device, probe) == originalMode);
        printf("RACEUPSHOT_ACTIVE_JSON:{\"originalMode\":%d,\"activeMode\":%d,\"restored\":%s,\"error\":\"Active-mode switch failed.\"}\n",
               originalMode, activeMode, restored ? "true" : "false");
        return restored;
    }
    int started = simple_reader_command(device, probe, 0x41);
    printf("Active SDK start-read acknowledged: %s\n", started ? "yes" : "no");
    if (started) {
        for (int second = 0; second < 8; second++) {
            probe->count = 0;
            for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
            if (probe->count) {
                printf("Active second %d (%zu bytes):\n", second + 1, probe->count);
                print_frames(probe->received, probe->count);
            }
        }
    }
    int stopped = !started || simple_reader_command(device, probe, 0x40);
    int restored = originalMode == 1 || (set_work_mode(device, probe, (uint8_t)originalMode) && work_mode_value(device, probe) == originalMode);
    printf("RACEUPSHOT_ACTIVE_JSON:{\"originalMode\":%d,\"activeMode\":%d,\"started\":%s,\"stopped\":%s,\"restored\":%s}\n",
           originalMode, activeMode, started ? "true" : "false", stopped ? "true" : "false", restored ? "true" : "false");
    return stopped && restored;
}

static int scan_one_tag(IOHIDDeviceRef device, Probe *probe, uint8_t *scannedEpc, size_t *scannedEpcLength, uint8_t *scannedTid, uint8_t *scannedPc) {
    int originalMode = work_mode_value(device, probe);
    if (originalMode < 0 || originalMode > 1) {
        puts("RACEUPSHOT_SCAN_JSON:{\"tags\":[],\"error\":\"One-tag scan requires verified answer or active mode; no setting changed.\"}");
        return 0;
    }
    int switched = originalMode == 1 || set_work_mode(device, probe, 1);
    if (!switched || work_mode_value(device, probe) != 1) {
        int restored = work_mode_value(device, probe) == originalMode
            || (set_work_mode(device, probe, (uint8_t)originalMode) && work_mode_value(device, probe) == originalMode);
        printf("RACEUPSHOT_SCAN_JSON:{\"tags\":[],\"error\":\"Active scan could not start%s.\"}\n", restored ? "" : " and original mode could not be restored");
        return 0;
    }
    ActiveScan scan = {0};
    int started = simple_reader_command(device, probe, 0x41);
    if (started) {
        for (int second = 0; second < 2; second++) {
            probe->count = 0;
            probe->overflowed = 0;
            for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
            collect_active_reports(probe, &scan);
            if (scan.reports >= 8 || scan.multiple || scan.malformed) break;
        }
    }
    int stopped = !started || simple_reader_command(device, probe, 0x40);
    int restored = work_mode_value(device, probe) == originalMode
        || (set_work_mode(device, probe, (uint8_t)originalMode) && work_mode_value(device, probe) == originalMode);
    if (!started || !stopped || !restored || scan.malformed || scan.multiple || !scan.hasEpc || scan.reports < 8) {
        printf("RACEUPSHOT_SCAN_JSON:{\"tags\":[],\"reports\":%d,\"error\":\"%s\"}\n", scan.reports,
               !restored ? "Original reader mode could not be restored" : scan.multiple ? "Multiple tags detected" : scan.malformed ? "Malformed active tag report" : "One stable tag was not detected");
        return 0;
    }
    uint8_t epc[42] = {0}, tid[12] = {0}, pc[2] = {0};
    int epcValid = read_tag_bank(device, probe, 1, 2, (uint8_t)(scan.epcLength / 2), epc);
    int pcValid = read_tag_bank(device, probe, 1, 1, 1, pc);
    if (!pcValid) {
        /* Some tags/readers reject a one-word PC read. A two-word read is
           still read-only; accept it only when its EPC word matches the
           independently verified active report. */
        uint8_t pcAndEpc[4] = {0};
        if (read_tag_bank(device, probe, 1, 1, 2, pcAndEpc)
            && memcmp(pcAndEpc + 2, epc, 2) == 0) {
            memcpy(pc, pcAndEpc, 2);
            pcValid = 1;
        }
    }
    int tidValid = read_tag_bank(device, probe, 2, 0, 6, tid);
    if (!epcValid || memcmp(epc, scan.epc, scan.epcLength) != 0) {
        puts("RACEUPSHOT_SCAN_JSON:{\"tags\":[],\"error\":\"Active EPC and full EPC bank read did not agree.\"}");
        return 0;
    }
    if (pcValid && (pc[0] >> 3) != scan.epcLength / 2) {
        puts("RACEUPSHOT_SCAN_JSON:{\"tags\":[],\"error\":\"Stored PC length and full EPC read did not agree.\"}");
        return 0;
    }
    if (scannedEpc) memcpy(scannedEpc, epc, scan.epcLength);
    if (scannedEpcLength) *scannedEpcLength = scan.epcLength;
    if (scannedTid && tidValid) memcpy(scannedTid, tid, 12);
    if (scannedPc && pcValid) memcpy(scannedPc, pc, 2);
    printf("RACEUPSHOT_SCAN_JSON:{\"tags\":[{\"epc\":\"");
    for (size_t index = 0; index < scan.epcLength; index++) printf("%02X", epc[index]);
    printf("\",\"tid\":");
    if (tidValid) {
        putchar('"');
        for (size_t index = 0; index < 12; index++) printf("%02X", tid[index]);
        putchar('"');
    } else printf("null");
    printf(",\"pc\":");
    if (pcValid) printf("\"%02X%02X\"", pc[0], pc[1]);
    else printf("null");
    printf("}],\"reports\":%d,\"error\":null}\n", scan.reports);
    return 1;
}

static int parse_hex_epc(const char *hex, uint8_t *bytes, size_t *byteLength) {
    if (!hex) return 0;
    const size_t length = strlen(hex);
    if (length < 4 || length > 84 || length % 4 != 0) return 0;
    for (size_t index = 0; index < length; index++) {
        char value = hex[index];
        if (!((value >= '0' && value <= '9') || (value >= 'A' && value <= 'F') || (value >= 'a' && value <= 'f'))) return 0;
    }
    for (size_t index = 0; index < length / 2; index++) {
        unsigned value = 0;
        if (sscanf(hex + index * 2, "%2x", &value) != 1) return 0;
        bytes[index] = (uint8_t)value;
    }
    *byteLength = length / 2;
    return 1;
}

static int build_write_card_command(uint8_t *command, uint8_t wordPointer, const uint8_t *data, size_t byteLength) {
    /* SDK CFHid_WriteCardG2: EPC bank 1, variable word pointer and count.
       One 64-byte HID report can carry at most 48 data bytes. */
    if (!data || byteLength < 2 || byteLength > 48 || byteLength % 2) return 0;
    memset(command, 0, 64);
    command[0] = (uint8_t)(14 + byteLength);
    command[1] = 0x53; command[2] = 0x57;
    command[4] = (uint8_t)(10 + byteLength);
    command[5] = 0xFF; command[6] = 0x03;
    command[7] = 1; command[8] = wordPointer;
    command[9] = (uint8_t)(byteLength / 2);
    memcpy(command + 14, data, byteLength);
    unsigned sum = 0;
    for (size_t index = 1; index < 14 + byteLength; index++) sum += command[index];
    command[14 + byteLength] = (uint8_t)(0u - sum);
    return 1;
}

static int write_epc_bank(IOHIDDeviceRef device, Probe *probe, uint8_t wordPointer, const uint8_t *data, size_t byteLength, int *responseCode) {
    uint8_t command[64];
    if (!build_write_card_command(command, wordPointer, data, byteLength)) return -1;
    probe->count = 0;
    probe->overflowed = 0;
    if (IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, command, sizeof(command)) != kIOReturnSuccess) return -1;
    const uint8_t *frame = wait_frame(probe, 0x03, 9, 3000);
    if (!frame) {
        if (responseCode) *responseCode = -1;
        return -1;
    }
    if (responseCode) *responseCode = frame[7];
    return frame[7] == 1 ? 1 : 0;
}

static int write_one_tag(IOHIDDeviceRef device, Probe *probe, const char *currentHex, const char *tidHex, const char *newHex) {
    uint8_t expectedEpc[42] = {0}, expectedTid[42] = {0}, requestedEpc[42] = {0};
    size_t expectedLength = 0, tidLength = 0, requestedLength = 0;
    if (!parse_hex_epc(currentHex, expectedEpc, &expectedLength)
        || !parse_hex_epc(tidHex, expectedTid, &tidLength) || tidLength != 12
        || !parse_hex_epc(newHex, requestedEpc, &requestedLength)
        || (expectedLength == requestedLength && memcmp(expectedEpc, requestedEpc, expectedLength) == 0)) {
        puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"Expected a distinct whole-word hexadecimal EPC and a 12-byte TID.\"}");
        return 0;
    }
    uint8_t beforeEpc[42] = {0}, beforeTid[12] = {0}, beforePc[2] = {0};
    size_t beforeLength = 0;
    int initialScanComplete = 0;
    for (int attempt = 0; attempt < 3; attempt++) {
        memset(beforeEpc, 0, sizeof(beforeEpc));
        memset(beforeTid, 0, sizeof(beforeTid));
        memset(beforePc, 0, sizeof(beforePc));
        beforeLength = 0;
        if (!scan_one_tag(device, probe, beforeEpc, &beforeLength, beforeTid, beforePc)) continue;
        if (beforeLength != expectedLength) {
            printf("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"No write was sent: the chip EPC length changed before writing (read %zu bytes, expected %zu bytes). Press READ EPC and retry only if this is the intended tag.\"}\n", beforeLength, expectedLength);
            return 0;
        }
        if (memcmp(beforeTid, expectedTid, 12) != 0) {
            puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"No write was sent: the tag TID changed after READ EPC. Remove other tags and reread the intended chip.\"}");
            return 0;
        }
        if (memcmp(beforeEpc, expectedEpc, expectedLength) != 0) {
            puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"No write was sent: the tag EPC changed after READ EPC. Press READ EPC to refresh the current EPC before retrying.\"}");
            return 0;
        }
        if ((beforePc[0] >> 3) != expectedLength / 2) {
            printf("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"No write was sent: Stored PC %02X%02X does not describe the current EPC length. Reread the chip; do not retry until PC matches.\"}\n", beforePc[0], beforePc[1]);
            return 0;
        }
        initialScanComplete = 1;
        break;
    }
    if (!initialScanComplete) {
        puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"No write was sent: the reader could not complete a stable EPC/TID/PC scan after three attempts. Keep one chip still on the antenna and press READ EPC again.\"}");
        return 0;
    }
    /* A second independent scan narrows the window for a swapped or nearby tag.
       Retry transient/incomplete reads, but never proceed if a different EPC,
       TID, or non-empty PC is actually observed. */
    int secondScanVerified = 0;
    const char *secondScanFailure = "Second physical tag scan did not return a complete EPC/TID/PC after three attempts.";
    for (int attempt = 0; attempt < 3; attempt++) {
        uint8_t confirmedEpc[42] = {0}, confirmedTid[12] = {0}, confirmedPc[2] = {0};
        size_t confirmedLength = 0;
        if (!scan_one_tag(device, probe, confirmedEpc, &confirmedLength, confirmedTid, confirmedPc)) continue;
        if (confirmedLength != expectedLength || memcmp(confirmedEpc, expectedEpc, expectedLength)) {
            secondScanFailure = "Physical EPC changed between verification scans. No write was sent.";
            break;
        }
        const uint8_t emptyTid[12] = {0}, emptyPc[2] = {0};
        if (memcmp(confirmedTid, emptyTid, sizeof(emptyTid)) == 0
            || memcmp(confirmedPc, emptyPc, sizeof(emptyPc)) == 0) continue;
        if (memcmp(confirmedTid, expectedTid, 12)) {
            secondScanFailure = "Physical TID changed between verification scans. No write was sent.";
            break;
        }
        if (memcmp(confirmedPc, beforePc, 2)) {
            secondScanFailure = "Stored PC changed between verification scans. No write was sent.";
            break;
        }
        secondScanVerified = 1;
        break;
    }
    if (!secondScanVerified) {
        printf("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"%s\"}\n", secondScanFailure);
        return 0;
    }
    int writeResponseCode = -1;
    int writeResult = write_epc_bank(device, probe, 2, requestedEpc, requestedLength, &writeResponseCode);
    int confirmedEpcAbsent = 0;
    /* Some RU5600 firmware drops the write acknowledgement even when the HID
       command was accepted. Before reporting failure, independently scan the
       same TID/PC and read the requested EPC word range. If it is still not
       present, one bounded idempotent retry is safe; never retry a different
       tag or a changed PC. */
    for (int attempt = 0; writeResult != 1 && attempt < 2; attempt++) {
        uint8_t retryVisibleEpc[42] = {0}, retryTid[12] = {0}, retryPc[2] = {0};
        uint8_t retryEpcBank[42] = {0};
        size_t retryVisibleLength = 0;
        if (!scan_one_tag(device, probe, retryVisibleEpc, &retryVisibleLength, retryTid, retryPc)
            || retryVisibleLength != expectedLength || memcmp(retryTid, expectedTid, 12)
            || memcmp(retryPc, beforePc, 2)) {
            break;
        }
        const int visibleIsOriginal = memcmp(retryVisibleEpc, expectedEpc, expectedLength) == 0;
        const int visibleHasRequestedPrefix = memcmp(retryVisibleEpc, requestedEpc, expectedLength < requestedLength ? expectedLength : requestedLength) == 0;
        if (!visibleIsOriginal && !visibleHasRequestedPrefix) break;
        const int fullEpcRead = read_tag_bank(device, probe, 1, 2, (uint8_t)(requestedLength / 2), retryEpcBank);
        if (fullEpcRead && memcmp(retryEpcBank, requestedEpc, requestedLength) == 0) {
            /* The full payload is physically present on the same TID. Treat
               the missing acknowledgement as recoverable and continue with
               Stored PC update/read-back below. */
            writeResult = 1;
            break;
        }
        if (fullEpcRead) confirmedEpcAbsent = 1;
        if (attempt == 0) writeResult = write_epc_bank(device, probe, 2, requestedEpc, requestedLength, &writeResponseCode);
    }
    if (writeResult != 1 && !confirmedEpcAbsent) {
        puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"UNKNOWN_OUTCOME\",\"error\":\"Write acknowledgement was missing and the same-TID EPC bank could not be conclusively read. No automatic retry was made.\"}");
        return 0;
    }
    if (requestedLength != expectedLength && writeResult == 1) {
        /* A length change is two-stage. While PC still advertises the old
           length, retry the stable scan and read the entire requested EPC
           word range directly; the active scan alone can only expose the old
           prefix and is not proof that the new EPC was fully written. */
        int stagedEpcVerified = 0;
        int fullEpcReadCompleted = 0;
        for (int attempt = 0; attempt < 3; attempt++) {
            uint8_t interimEpc[42] = {0}, interimTid[12] = {0}, interimPc[2] = {0};
            uint8_t fullEpc[42] = {0};
            size_t interimLength = 0;
            if (!scan_one_tag(device, probe, interimEpc, &interimLength, interimTid, interimPc)) continue;
            if (interimLength != expectedLength || memcmp(interimTid, expectedTid, 12)
                || memcmp(interimPc, beforePc, 2)
                || memcmp(interimEpc, requestedEpc, expectedLength < requestedLength ? expectedLength : requestedLength)) {
                puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"UNKNOWN_OUTCOME\",\"error\":\"Length-change checkpoint did not match the same TID, original PC, and requested EPC prefix. Stored PC was not changed. Read the chip again before any retry.\"}");
                return 0;
            }
            if (!read_tag_bank(device, probe, 1, 2, (uint8_t)(requestedLength / 2), fullEpc)) continue;
            fullEpcReadCompleted = 1;
            if (memcmp(fullEpc, requestedEpc, requestedLength) == 0) {
                stagedEpcVerified = 1;
                break;
            }
            if (attempt == 0) {
                /* Same TID, unchanged PC, and matching old-length prefix were
                   just confirmed, so one repeat of the identical EPC-bank
                   payload is safe before checking again. */
                writeResult = write_epc_bank(device, probe, 2, requestedEpc, requestedLength, &writeResponseCode);
            }
        }
        if (!stagedEpcVerified) {
            if (fullEpcReadCompleted) {
                if (writeResponseCode < 0) {
                    puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"WRITE_FAILED\",\"error\":\"The same TID and original PC were confirmed, but the full EPC bank still did not match after one retry and the RU5600 returned no write acknowledgement. For this same-length write, tag capacity is not the issue; check whether the EPC bank is write-locked.\"}");
                } else {
                    printf("RACEUPSHOT_WRITE_JSON:{\"state\":\"WRITE_FAILED\",\"error\":\"The same TID and original PC were confirmed, but the full EPC bank still did not match after one retry. RU5600 write response code: %d (1 means accepted). For this same-length write, tag capacity is not the issue; check whether the EPC bank is write-locked.\"}\n", writeResponseCode);
                }
            } else {
                puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"UNKNOWN_OUTCOME\",\"error\":\"The same-TID full EPC-bank checkpoint could not be read reliably. Stored PC was not changed. Read the tag again before retrying.\"}");
            }
            return 0;
        }
        uint8_t newPc[2] = { (uint8_t)((beforePc[0] & 7u) | ((requestedLength / 2) << 3)), beforePc[1] };
        int pcResponseCode = -1;
        int pcWrite = write_epc_bank(device, probe, 1, newPc, 2, &pcResponseCode);
        if (pcWrite != 1) {
            printf("RACEUPSHOT_WRITE_JSON:{\"state\":\"UNKNOWN_OUTCOME\",\"error\":\"Stored PC length update was not confirmed on the same TID. RU5600 write response code: %d. Rescan before retrying.\"}\n", pcResponseCode);
            return 0;
        }
    }
    uint8_t afterEpc[42], afterTid[12] = {0}, afterPc[2] = {0};
    size_t afterLength = 0;
    int readBack = scan_one_tag(device, probe, afterEpc, &afterLength, afterTid, afterPc);
    if (readBack && afterLength == requestedLength && memcmp(afterTid, expectedTid, 12) == 0
        && memcmp(afterEpc, requestedEpc, requestedLength) == 0
        && (afterPc[0] >> 3) == requestedLength / 2
        && (afterPc[0] & 7u) == (beforePc[0] & 7u) && afterPc[1] == beforePc[1]) {
        printf("RACEUPSHOT_WRITE_JSON:{\"state\":\"VERIFIED\",\"after\":{\"epc\":\"");
        for (size_t index = 0; index < requestedLength; index++) printf("%02X", afterEpc[index]);
        printf("\",\"tid\":\"");
        for (size_t index = 0; index < 12; index++) printf("%02X", afterTid[index]);
        puts("\"},\"error\":null}");
        return 1;
    }
    if (readBack && afterLength == expectedLength && memcmp(afterTid, expectedTid, 12) == 0
        && memcmp(afterEpc, expectedEpc, expectedLength) == 0 && memcmp(afterPc, beforePc, 2) == 0
        && (writeResult == 0 || confirmedEpcAbsent)) {
        if (expectedLength == requestedLength) {
            if (writeResponseCode < 0) {
                puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"WRITE_FAILED\",\"error\":\"Same TID and Stored PC were confirmed unchanged after one retry, but the RU5600 returned no write acknowledgement. The EPC bank did not change. Since this is a same-length replacement, EPC capacity is sufficient; the tag may reject writes because its EPC bank is locked.\"}");
            } else {
                printf("RACEUPSHOT_WRITE_JSON:{\"state\":\"WRITE_FAILED\",\"error\":\"Same TID and Stored PC were confirmed unchanged after one retry. The EPC bank did not change. RU5600 write response code: %d (1 means accepted). Since this is a same-length replacement, EPC capacity is sufficient; this code indicates the reader/tag rejected or failed the write.\"}\n", writeResponseCode);
            }
        } else {
            puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"WRITE_FAILED\",\"error\":\"Same TID and Stored PC were confirmed, but the requested EPC was absent from the EPC bank after one safe retry. The tag may not support this requested length or its EPC bank may be write-locked.\"}");
        }
        return 0;
    }
    puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"UNKNOWN_OUTCOME\",\"error\":\"Write or same-TID read-back was inconclusive. Do not retry before rescanning the tag.\"}");
    return 0;
}

static int inspect(IOHIDDeviceRef device, int watch, int answerMode, int listenOnly, int readMemory, int statusOnly, int readJson, int inventoryJson, int activeJson, int scanJson, const char *writeCurrent, const char *writeTid, const char *writeNew) {
    const int location = number(device, CFSTR("LocationID"));
    const int usagePage = number(device, CFSTR(kIOHIDPrimaryUsagePageKey));
    const int usage = number(device, CFSTR(kIOHIDPrimaryUsageKey));
    printf("VID=0x%04X PID=0x%04X location=0x%08X usagePage=0x%04X usage=0x%04X\n",
           number(device, CFSTR(kIOHIDVendorIDKey)), number(device, CFSTR(kIOHIDProductIDKey)),
           location, usagePage, usage);
    if (usagePage != 0xFF00 || usage != 1) {
        puts("Skipping keyboard-emulation interface.");
        return 0;
    }
    IOReturn status = IOHIDDeviceOpen(device, kIOHIDOptionsTypeNone);
    if (status != kIOReturnSuccess) {
        printf("HID open failed: 0x%08X (permission or another process may own it)\n", status);
        return 0;
    }
    Probe probe = {0};
    IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    IOHIDDeviceRegisterInputReportCallback(device, probe.report, sizeof(probe.report), input_report, &probe);

    /* Linux SDK CFHid_OpenDevice sends this feature report before commands.
       It may be unsupported by this macOS HID interface; report the result. */
    uint8_t feature[32] = {0};
    feature[0] = 0xFF; feature[1] = 0xC7; feature[2] = 0x83;
    feature[3] = 0xCC; feature[4] = 0x30;
    status = IOHIDDeviceSetReport(device, kIOHIDReportTypeFeature, 0, feature, sizeof(feature));
    printf("SDK feature initialization: 0x%08X\n", status);

    /* SDK CFHid_GetDeviceSystemInfo: command 0x10, no payload.
       Frame construction is copied from CFHid_SendCommand in the supplied SDK. */
    uint8_t command[64] = {7, 0x53, 0x57, 0x00, 0x03, 0xFF, 0x10};
    unsigned sum = 0;
    for (size_t index = 1; index < 7; index++) sum += command[index];
    command[7] = (uint8_t)(0u - sum);
    printf("SDK read-only device-info command: ");
    print_hex(command, 8);
    status = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, command, sizeof(command));
    printf("Output report result: 0x%08X\n", status);
    const uint8_t *deviceInfo = status == kIOReturnSuccess ? wait_frame(&probe, 0x10, 18, 1200) : NULL;
    if (status == kIOReturnSuccess) {
        printf("Raw input (%zu bytes): ", probe.count);
        print_frames(probe.received, probe.count);
    }
    const int deviceInfoValid = deviceInfo && deviceInfo[7] == 0x01;
    if (statusOnly) {
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
        return deviceInfoValid;
    }
    if (inventoryJson) {
        int result = inspect_inventory_in_answer_mode(device, &probe);
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
        return result;
    }
    if (activeJson) {
        int result = inspect_active_reports(device, &probe);
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
        return result;
    }
    if (scanJson) {
        int result = scan_one_tag(device, &probe, NULL, NULL, NULL, NULL);
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
        return result;
    }
    if (writeCurrent) {
        int result = write_one_tag(device, &probe, writeCurrent, writeTid, writeNew);
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
        return result;
    }
    /* Supplied Linux SDK CFHid_ReadFreq: command 0x3E, zero payload. */
    uint8_t frequency[64] = {7, 0x53, 0x57, 0x00, 0x03, 0xFF, 0x3E};
    unsigned frequencySum = 0;
    for (size_t index = 1; index < 7; index++) frequencySum += frequency[index];
    frequency[7] = (uint8_t)(0u - frequencySum);
    probe.count = 0;
    status = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, frequency, sizeof(frequency));
    printf("SDK read-only frequency query result: 0x%08X\n", status);
    if (status == kIOReturnSuccess) {
        for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
        print_frames(probe.received, probe.count);
    }
    read_device_parameter(device, &probe, 0x02, "work-mode");
    read_device_parameter(device, &probe, 0x05, "RF-power");
    if (listenOnly) {
        puts("Listening for unsolicited vendor-HID tag reports for 12 seconds. Present one chip now.");
        for (int second = 0; second < 12; second++) {
            probe.count = 0;
            for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
            if (probe.count) {
                printf("Second %d input (%zu bytes):\n", second + 1, probe.count);
                print_frames(probe.received, probe.count);
            }
        }
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
        return 1;
    }
    if (readMemory || readJson) {
        uint8_t epc[12] = {0}, tid[12] = {0};
        const int epcValid = read_tag_bank(device, &probe, 1, 2, 6, epc);
        const int tidValid = read_tag_bank(device, &probe, 2, 0, 6, tid);
        if (readJson) {
            if (epcValid && tidValid) {
                printf("RACEUPSHOT_READ_JSON:{\"tags\":[{\"epc\":\"");
                for (size_t index = 0; index < sizeof(epc); index++) printf("%02X", epc[index]);
                printf("\",\"tid\":\"");
                for (size_t index = 0; index < sizeof(tid); index++) printf("%02X", tid[index]);
                puts("\"}],\"error\":null}");
            } else puts("RACEUPSHOT_READ_JSON:{\"tags\":[],\"error\":\"No complete EPC and TID read-back from one chip.\"}");
        }
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
        return 1;
    }
    if (answerMode) {
        uint8_t stop[64] = {7, 0x53, 0x57, 0x00, 0x03, 0xFF, 0x40};
        unsigned stopSum = 0;
        for (size_t index = 1; index < 7; index++) stopSum += stop[index];
        stop[7] = (uint8_t)(0u - stopSum);
        probe.count = 0;
        status = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, stop, sizeof(stop));
        printf("SDK stop-continuous-read result: 0x%08X\n", status);
        for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
        print_frames(probe.received, probe.count);
    }
    uint8_t inventory[64] = {10, 0x53, 0x57, 0x00, 0x06, 0xFF, 0x01, 0, 0, 0};
    sum = 0;
    for (size_t index = 1; index < 10; index++) sum += inventory[index];
    inventory[10] = (uint8_t)(0u - sum);
    printf("SDK read-only inventory command: ");
    print_hex(inventory, 11);
    for (int attempt = 0; attempt < (watch ? 12 : 1); attempt++) {
        probe.count = 0;
        status = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, inventory, sizeof(inventory));
        printf("Inventory attempt %d output result: 0x%08X\n", attempt + 1, status);
        if (status != kIOReturnSuccess) break;
        for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
        printf("Inventory input (%zu bytes):\n", probe.count);
        print_frames(probe.received, probe.count);
    }
    if (answerMode) {
        uint8_t start[64] = {7, 0x53, 0x57, 0x00, 0x03, 0xFF, 0x41};
        unsigned startSum = 0;
        for (size_t index = 1; index < 7; index++) startSum += start[index];
        start[7] = (uint8_t)(0u - startSum);
        probe.count = 0;
        status = IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, start, sizeof(start));
        printf("SDK restore-continuous-read result: 0x%08X\n", status);
        for (int index = 0; index < 10; index++) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
        print_frames(probe.received, probe.count);
    }
    IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
    return 1;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        const uint8_t observed[] = {
            0x20,0x43,0x54,0x00,0x1C,0x00,0x45,0x01,0xD3,0x04,0x26,0x03,0x26,0x72,0xC7,
            0x01,0x0F,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x05,0x98,0x00,0xF8
        };
        Probe fixture = {0};
        memcpy(fixture.received, observed, sizeof(observed));
        fixture.count = 64;
        ActiveScan one = {0};
        collect_active_reports(&fixture, &one);
        if (one.reports != 1 || !one.hasEpc || one.multiple || one.malformed) return 1;
        fixture.received[15] = 2;
        fixture.received[32] = (uint8_t)(fixture.received[32] - 1);
        ActiveScan two = {0};
        collect_active_reports(&fixture, &two);
        if (!two.multiple) return 2;
        fixture.received[32] ^= 1;
        ActiveScan corrupt = {0};
        collect_active_reports(&fixture, &corrupt);
        if (!corrupt.malformed) return 3;
        const size_t lengths[] = {2, 8, 12, 16, 32, 42};
        for (size_t sample = 0; sample < sizeof(lengths) / sizeof(lengths[0]); sample++) {
            const size_t epcLength = lengths[sample];
            memset(&fixture, 0, sizeof(fixture));
            memcpy(fixture.received, observed, 19);
            fixture.received[0] = (uint8_t)(20 + epcLength);
            fixture.received[4] = (uint8_t)(16 + epcLength);
            fixture.received[16] = (uint8_t)(3 + epcLength);
            for (size_t index = 0; index < epcLength; index++) fixture.received[19 + index] = (uint8_t)index;
            fixture.received[19 + epcLength] = 0xF8;
            unsigned checksum = 0;
            for (size_t index = 1; index < 20 + epcLength; index++) checksum += fixture.received[index];
            fixture.received[20 + epcLength] = (uint8_t)(0u - checksum);
            fixture.count = 64;
            ActiveScan variable = {0};
            collect_active_reports(&fixture, &variable);
            if (variable.reports != 1 || !variable.hasEpc || variable.epcLength != epcLength
                || variable.multiple || variable.malformed) return 4;
        }
        const uint8_t replacement[12] = {0,0,0,0,0,0,0,0,0,1,5,0x92};
        uint8_t writeCommand[64];
        if (!build_write_card_command(writeCommand, 2, replacement, sizeof(replacement))
            || writeCommand[0] != 26 || writeCommand[4] != 22 || writeCommand[8] != 2
            || writeCommand[9] != 6 || memcmp(writeCommand + 14, replacement, sizeof(replacement))) return 5;
        unsigned writeSum = 0;
        for (size_t index = 1; index <= writeCommand[0]; index++) writeSum += writeCommand[index];
        if ((writeSum & 0xFFu) != 0) return 6;
        const uint8_t oldPc[2] = {0x18, 0x00};
        const uint8_t newPc[2] = { (uint8_t)((oldPc[0] & 7u) | ((sizeof(replacement) / 2) << 3)), oldPc[1] };
        if (newPc[0] != 0x30 || newPc[1] != 0
            || !build_write_card_command(writeCommand, 1, newPc, 2)
            || writeCommand[0] != 16 || writeCommand[9] != 1 || writeCommand[14] != 0x30) return 7;
        puts("RACEUPSHOT_SELF_TEST:PASS variable EPC reads, write frames, PC length calculation, one-tag and checksum guards");
        return 0;
    }
    int watch = 0, answerMode = 0, listenOnly = 0, keyboardOnly = 0, readMemory = 0, statusOnly = 0, readJson = 0, inventoryJson = 0, activeJson = 0, scanJson = 0;
    const char *writeCurrent = NULL, *writeTid = NULL, *writeNew = NULL;
    for (int index = 1; index < argc; index++) {
        if (strcmp(argv[index], "--watch") == 0) watch = 1;
        if (strcmp(argv[index], "--answer-mode") == 0) answerMode = 1;
        if (strcmp(argv[index], "--listen") == 0) listenOnly = 1;
        if (strcmp(argv[index], "--keyboard") == 0) keyboardOnly = 1;
        if (strcmp(argv[index], "--read-memory") == 0) readMemory = 1;
        if (strcmp(argv[index], "--status-json") == 0) statusOnly = 1;
        if (strcmp(argv[index], "--read-json") == 0) readJson = 1;
        if (strcmp(argv[index], "--inventory-json") == 0) inventoryJson = 1;
        if (strcmp(argv[index], "--active-inventory-json") == 0) activeJson = 1;
        if (strcmp(argv[index], "--scan-json") == 0) scanJson = 1;
        if (strcmp(argv[index], "--write-once") == 0 && index + 3 < argc) {
            writeCurrent = argv[++index];
            writeTid = argv[++index];
            writeNew = argv[++index];
        }
    }
    if (writeCurrent) {
        /* Standalone writer is an explicitly gated hardware diagnostic, not
           the production bridge. Cloud uniqueness must be checked first. */
        const char *enabledEpc = getenv("RACEUPSHOT_RFID_HARDWARE_TEST_EPC");
        if (!enabledEpc || !writeNew || strcmp(enabledEpc, writeNew) != 0) {
            puts("RACEUPSHOT_WRITE_JSON:{\"state\":\"BLOCKED\",\"error\":\"Hardware test EPC gate is not set.\"}");
            return 2;
        }
    }
    IOHIDManagerRef manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    if (!manager) return 1;
    IOHIDManagerSetDeviceMatching(manager, NULL);
    IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    IOReturn status = IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone);
    if (status != kIOReturnSuccess) {
        printf("HID manager failed: 0x%08X\n", status);
        CFRelease(manager);
        return 1;
    }
    CFSetRef devices = IOHIDManagerCopyDevices(manager);
    if (!devices) {
        puts("No HID devices found.");
        CFRelease(manager);
        return 1;
    }
    CFIndex count = CFSetGetCount(devices);
    const void **values = calloc((size_t)count, sizeof(*values));
    CFSetGetValues(devices, values);
    int matches = 0, availableReaders = 0;
    for (CFIndex index = 0; index < count; index++) {
        IOHIDDeviceRef device = (IOHIDDeviceRef)values[index];
        if (number(device, CFSTR(kIOHIDVendorIDKey)) == 0x1A86 && number(device, CFSTR(kIOHIDProductIDKey)) == 0xE010 &&
            number(device, CFSTR(kIOHIDPrimaryUsagePageKey)) == 0xFF00 && number(device, CFSTR(kIOHIDPrimaryUsageKey)) == 1) availableReaders++;
    }
    if ((readJson || scanJson || writeCurrent) && availableReaders != 1) {
        printf("%s{\"tags\":[],\"error\":\"Expected exactly one connected RU5600 reader.\"}\n", writeCurrent ? "RACEUPSHOT_WRITE_JSON:" : scanJson ? "RACEUPSHOT_SCAN_JSON:" : "RACEUPSHOT_READ_JSON:");
        free(values); CFRelease(devices); IOHIDManagerClose(manager, kIOHIDOptionsTypeNone); CFRelease(manager);
        return 2;
    }
    for (CFIndex index = 0; index < count; index++) {
        IOHIDDeviceRef device = (IOHIDDeviceRef)values[index];
        if (number(device, CFSTR(kIOHIDVendorIDKey)) != 0x1A86 || number(device, CFSTR(kIOHIDProductIDKey)) != 0xE010) continue;
        if (keyboardOnly) {
            if (number(device, CFSTR(kIOHIDPrimaryUsagePageKey)) == 1 && number(device, CFSTR(kIOHIDPrimaryUsageKey)) == 6)
                matches += listen_keyboard(device);
        } else matches += inspect(device, watch, answerMode, listenOnly, readMemory, statusOnly, readJson, inventoryJson, activeJson, scanJson, writeCurrent, writeTid, writeNew);
    }
    printf("Vendor HID interfaces probed: %d\n", matches);
    if (statusOnly) {
        const char *state = availableReaders == 0 ? "DISCONNECTED" : availableReaders > 1 ? "ERROR" : matches == 1 ? "CONNECTED" : "ERROR";
        const char *error = availableReaders > 1 ? "Multiple RU5600-compatible USB readers detected." : availableReaders == 1 && matches == 0 ? "USB reader detected but SDK device-info communication failed." : "";
        printf("RACEUPSHOT_STATUS_JSON:{\"state\":\"%s\",\"availableReaders\":%d,\"model\":\"RU5600-compatible SWUSB_HID\",\"connectionType\":\"macOS USB HID\",\"canReadEpc\":true,\"canWriteEpc\":false,\"error\":\"%s\"}\n", state, availableReaders, error);
    }
    free(values);
    CFRelease(devices);
    IOHIDManagerClose(manager, kIOHIDOptionsTypeNone);
    CFRelease(manager);
    return statusOnly ? 0 : matches ? 0 : 2;
}
