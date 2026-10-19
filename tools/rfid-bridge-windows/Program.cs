using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// This bridge runs only on the operator's Windows computer. It is not hosted
// by RACEUPSHOT. Native signatures follow the supplied x64 C# SDK declarations.
// Validate against the physical reader before production use.
internal static class Ru5600
{
    private const string Dll = "CFHidApi.dll";
    [DllImport(Dll)] internal static extern int CFHid_GetUsbCount();
    [DllImport(Dll)] internal static extern bool CFHid_OpenDevice(ushort index);
    [DllImport(Dll)] internal static extern bool CFHid_CloseDevice();
    [DllImport(Dll)] internal static extern bool CFHid_GetDeviceSystemInfo(byte address, byte[] info);
    [DllImport(Dll)] internal static extern bool CFHid_InventoryG2(byte address, byte[] buffer, out ushort totalLength, out ushort cardNumber);
    [DllImport(Dll)] internal static extern bool CFHid_ReadCardG2(byte address, byte[] password, byte bank, byte wordPointer, byte wordLength, byte[] data);
    [DllImport(Dll)] internal static extern bool CFHid_WriteCardG2(byte address, byte[] password, byte bank, byte wordPointer, byte wordLength, byte[] data);
}

internal sealed record Tag(string epc, string? tid, int? antenna, int? rssi, int readCount, string readAt);
internal sealed record WriteRequest(string currentEpc, string? tid, string newEpc, string transactionId, long expiresAtMs, string signature);
internal sealed record LocalWriteRequest(string currentEpc, string? tid, string newEpc);
internal sealed record ReviewRequest(string transactionId);
internal sealed record DetectionConfig(decimal? rfPowerDbm, int[] antennaIds, decimal targetRangeCm, int absenceTimeoutMs,
    bool singleReadPerEntry, bool reentryDetection, bool suppressDuplicateInventory, int? rssiThreshold,
    bool presenceMonitoring, bool physicallyCalibrated, string calibrationMethod, string calibrationNotes);

internal static class Program
{
    private const byte Address = 0xFF;
    private static readonly SemaphoreSlim ReaderLock = new(1, 1);
    private static bool connected;
    private static string? firmware;
    private static string signingSecret = "";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static DetectionConfig detectionConfig = new(null, Array.Empty<int>(), 15.24m, 1000, true, true, true, null, true, false, "UNVERIFIED", "");

    private static DetectionConfig ValidateDetectionConfig(DetectionConfig value)
    {
        if (value.rfPowerDbm is < -30 or > 36) throw new InvalidOperationException("RF power must be between -30 and 36 dBm.");
        if (value.targetRangeCm <= 0 || value.targetRangeCm > 15.24m) throw new InvalidOperationException("Detection target cannot exceed 15.24 cm.");
        if (value.absenceTimeoutMs < 100 || value.absenceTimeoutMs > 60000) throw new InvalidOperationException("Absence timeout must be between 100 and 60000 ms.");
        if (value.rssiThreshold is < -120 or > 0) throw new InvalidOperationException("RSSI threshold must be between -120 and 0 dBm.");
        var antennas = (value.antennaIds ?? Array.Empty<int>()).Distinct().ToArray();
        if (antennas.Any(antenna => antenna < 1 || antenna > 64)) throw new InvalidOperationException("Invalid antenna selection.");
        if (value.physicallyCalibrated && (value.calibrationMethod == "UNVERIFIED" || (value.calibrationNotes ?? "").Trim().Length < 10))
            throw new InvalidOperationException("Physical calibration requires a method and bench-test notes.");
        return value with { antennaIds = antennas, calibrationNotes = (value.calibrationNotes ?? "").Trim() };
    }

    private static string Sign(string payload)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(signingSecret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)));
    }

    private static bool SignatureMatches(string supplied, string expected)
    {
        if (supplied.Length != 64 || !supplied.All(Uri.IsHexDigit)) return false;
        return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(supplied), Convert.FromHexString(expected));
    }

    private static object Status()
    {
        if (connected && !Ru5600.CFHid_GetDeviceSystemInfo(Address, new byte[9]))
        {
            Ru5600.CFHid_CloseDevice();
            connected = false;
        }
        return new { state = connected ? "CONNECTED" : "DISCONNECTED", model = connected ? "INVETON RU5600" : null,
            firmware = connected ? firmware : null, connectionType = connected ? "USB HID / Windows SDK" : null,
            canReadEpc = connected, canWriteEpc = connected && Environment.GetEnvironmentVariable("RACEUPSHOT_RFID_WINDOWS_WRITE_VALIDATED") == "1", availableReaders = Ru5600.CFHid_GetUsbCount() };
    }

    private static Tag[] ReadTags()
    {
        if (!connected) throw new InvalidOperationException("Reader is disconnected.");
        var buffer = new byte[64000];
        if (!Ru5600.CFHid_InventoryG2(Address, buffer, out var length, out var cardCount))
            throw new InvalidOperationException("RU5600 inventory failed.");
        var tags = new List<Tag>();
        var offset = 0;
        for (var index = 0; index < cardCount; index++)
        {
            if (offset >= length) throw new InvalidOperationException("Malformed RU5600 inventory buffer.");
            var packetLength = buffer[offset];
            if (packetLength < 5 || offset + packetLength + 1 > length) throw new InvalidOperationException("Invalid RU5600 tag packet.");
            var hasTimestamp = (buffer[offset + 1] & 0x80) != 0;
            var idLength = packetLength - (hasTimestamp ? 7 : 1);
            if (idLength < 3) throw new InvalidOperationException("Invalid RU5600 EPC packet.");
            // Matches the vendor's C# demo: type byte, antenna byte, EPC bytes, RSSI byte.
            var epcBytes = buffer.AsSpan(offset + 3, idLength - 2).ToArray();
            var epc = Convert.ToHexString(epcBytes);
            var antenna = (int)buffer[offset + 2];
            var rssi = (int)buffer[offset + 1 + idLength];
            tags.Add(new Tag(epc, null, antenna, rssi, 1, DateTimeOffset.UtcNow.ToString("O")));
            offset += packetLength + 1;
        }
        // The SDK read-card method does not select by EPC. Never read TID or
        // write when inventory sees multiple chips in RF range.
        if (tags.Count == 1)
        {
            var tidBytes = new byte[12];
            var tid = Ru5600.CFHid_ReadCardG2(Address, new byte[4], 2, 0, 6, tidBytes)
                && tidBytes.Any(value => value != 0)
                ? Convert.ToHexString(tidBytes) : null;
            tags[0] = tags[0] with { tid = tid };
        }
        return tags.ToArray();
    }

    private static bool WriteEpcAndPc(string newEpc)
    {
        if ((newEpc.Length != 12 && newEpc.Length != 24) || !newEpc.All(Uri.IsHexDigit))
            throw new InvalidOperationException("Replacement EPC must contain 12 or 24 hexadecimal characters.");
        var pcBytes = new byte[2];
        if (!Ru5600.CFHid_ReadCardG2(Address, new byte[4], 1, 1, 1, pcBytes))
            throw new InvalidOperationException("Tag PC length could not be read; no write was attempted.");
        var currentPc = (ushort)((pcBytes[0] << 8) | pcBytes[1]);
        var words = newEpc.Length / 4;
        var nextPc = (ushort)((currentPc & 0x07FF) | (words << 11));
        var epcBytes = Convert.FromHexString(newEpc);
        var payload = new byte[epcBytes.Length + 2];
        payload[0] = (byte)(nextPc >> 8);
        payload[1] = (byte)nextPc;
        epcBytes.CopyTo(payload, 2);
        return Ru5600.CFHid_WriteCardG2(Address, new byte[4], 1, 1, checked((byte)(words + 1)), payload);
    }

    private static async Task<object> Dispatch(string path, JsonElement body)
    {
        switch (path)
        {
            case "/status": return Status();
            case "/connect":
                if (connected) return Status();
                if (Ru5600.CFHid_GetUsbCount() != 1) throw new InvalidOperationException("Exactly one RU5600 USB reader must be connected.");
                if (!Ru5600.CFHid_OpenDevice(0)) throw new InvalidOperationException("RU5600 open failed.");
                var info = new byte[9];
                if (!Ru5600.CFHid_GetDeviceSystemInfo(Address, info))
                {
                    Ru5600.CFHid_CloseDevice();
                    throw new InvalidOperationException("RU5600 identification failed.");
                }
                connected = true;
                firmware = $"{info[0]}.{info[1]}";
                return Status();
            case "/disconnect":
                if (connected) Ru5600.CFHid_CloseDevice();
                connected = false;
                return Status();
            case "/configuration":
                var requestedConfig = body.Deserialize<DetectionConfig>(JsonOptions) ?? throw new InvalidOperationException("Detection configuration required.");
                detectionConfig = ValidateDetectionConfig(requestedConfig);
                return new {
                    config = detectionConfig, rfPowerApplied = false,
                    antennaSelectionApplied = detectionConfig.antennaIds.Length > 0,
                    rssiFilterApplied = detectionConfig.rssiThreshold is not null,
                    hardwareRangeGuaranteed = false,
                    warnings = new[] { "The audited Windows SDK declarations have no verified RF-power command. Validate the 15.24 cm zone using a near-field antenna and/or shielding." }
                };
            case "/read": return new { tags = ReadTags() };
            case "/review":
                var review = body.Deserialize<ReviewRequest>(JsonOptions) ?? throw new InvalidOperationException("Review transaction required.");
                if (string.IsNullOrWhiteSpace(review.transactionId)) throw new InvalidOperationException("Review transaction required.");
                var reviewed = ReadTags();
                if (reviewed.Length != 1 || string.IsNullOrEmpty(reviewed[0].tid)) throw new InvalidOperationException("Exactly one tag with TID must be present for review.");
                return new { actual = reviewed[0], attestation = Sign($"REVIEW|{review.transactionId}|{reviewed[0].epc}|{reviewed[0].tid}") };
            case "/write":
                if (Environment.GetEnvironmentVariable("RACEUPSHOT_RFID_WINDOWS_WRITE_VALIDATED") != "1") throw new InvalidOperationException("Physical Windows acceptance tests are required before writes.");
                if (signingSecret.Length < 32) throw new InvalidOperationException("Signed cloud writes require a shared signing key.");
                var command = body.Deserialize<WriteRequest>(JsonOptions) ?? throw new InvalidOperationException("Write request missing.");
                if (command.expiresAtMs < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    || command.expiresAtMs > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 120_000)
                    throw new InvalidOperationException("Cloud write permit expired or invalid.");
                var permitPayload = $"WRITE|{command.transactionId}|{command.currentEpc}|{command.tid}|{command.newEpc}|{command.expiresAtMs}";
                if (!SignatureMatches(command.signature, Sign(permitPayload))) throw new InvalidOperationException("Cloud write permit signature invalid.");
                var before = ReadTags();
                if (before.Length != 1 || string.IsNullOrEmpty(before[0].tid)) throw new InvalidOperationException("Exactly one tag with readable TID is required.");
                if (!string.Equals(before[0].epc, command.currentEpc, StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(before[0].tid, command.tid, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Chip identity changed after selection.");
                if (command.newEpc.Length < 4 || command.newEpc.Length > 124 || command.newEpc.Length % 4 != 0
                    || !command.newEpc.All(Uri.IsHexDigit)) throw new InvalidOperationException("Invalid EPC words.");
                if (!WriteEpcAndPc(command.newEpc))
                    throw new InvalidOperationException("RU5600 EPC write failed; inspect this chip before reuse.");
                await Task.Delay(180);
                var after = ReadTags();
                if (after.Length != 1) throw new InvalidOperationException("Write returned, but a single-tag read-back was not available.");
                return new { after = after[0], attestation = Sign($"WRITE|{command.transactionId}|{after[0].epc}|{after[0].tid}") };
            case "/write-local":
                if (Environment.GetEnvironmentVariable("RACEUPSHOT_RFID_WINDOWS_WRITE_VALIDATED") != "1") throw new InvalidOperationException("Physical Windows acceptance tests are required before writes.");
                var local = body.Deserialize<LocalWriteRequest>(JsonOptions) ?? throw new InvalidOperationException("Write request missing.");
                var localBefore = ReadTags();
                if (localBefore.Length != 1 || string.IsNullOrEmpty(localBefore[0].tid)) throw new InvalidOperationException("Exactly one tag with readable TID is required.");
                if (!string.Equals(localBefore[0].epc, local.currentEpc, StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(localBefore[0].tid, local.tid, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Chip identity changed after selection.");
                if (!WriteEpcAndPc(local.newEpc)) throw new InvalidOperationException("RU5600 EPC/PC write failed.");
                await Task.Delay(180);
                var localAfter = ReadTags();
                if (localAfter.Length != 1 || !string.Equals(localAfter[0].epc, local.newEpc, StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(localAfter[0].tid, local.tid, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Write was not verified on the same physical tag.");
                return new { after = localAfter[0] };
            default: throw new InvalidOperationException("Unknown bridge path.");
        }
    }

    private static async Task Main()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Vendor RU5600 DLL is Windows-only.");
        var key = Environment.GetEnvironmentVariable("RACEUPSHOT_RFID_BRIDGE_KEY");
        signingSecret = Environment.GetEnvironmentVariable("RACEUPSHOT_RFID_SIGNING_SECRET") ?? "";
        var origin = Environment.GetEnvironmentVariable("RACEUPSHOT_RFID_ALLOWED_ORIGIN") ?? "https://raceupshot.com";
        if (string.IsNullOrWhiteSpace(key) || key.Length < 24) throw new InvalidOperationException("Set a random RACEUPSHOT_RFID_BRIDGE_KEY of at least 24 characters.");
        using var listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:8766/");
        listener.Start();
        Console.WriteLine("RACEUPSHOT RU5600 bridge listening on 127.0.0.1:8766. No device is connected yet.");
        while (true)
        {
            var context = await listener.GetContextAsync();
            _ = Task.Run(async () =>
            {
                var request = context.Request;
                var response = context.Response;
                try
                {
                    if (request.Headers["Origin"] != origin) { response.StatusCode = 403; return; }
                    response.Headers["Access-Control-Allow-Origin"] = origin;
                    response.Headers["Vary"] = "Origin";
                    response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-RFID-Bridge-Key";
                    response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                    response.Headers["Access-Control-Allow-Private-Network"] = "true";
                    response.Headers["Cache-Control"] = "no-store";
                    if (request.HttpMethod == "OPTIONS") { response.StatusCode = 204; return; }
                    if (request.Headers["X-RFID-Bridge-Key"] != key) { response.StatusCode = 401; return; }
                    if (request.ContentLength64 > 16384) { response.StatusCode = 413; return; }
                    if (!ReaderLock.Wait(0)) { response.StatusCode = 409; await WriteJson(response, new { error = "Reader is busy." }); return; }
                    try
                    {
                        var body = request.HttpMethod == "POST"
                            ? await JsonSerializer.DeserializeAsync<JsonElement>(request.InputStream)
                            : default;
                        var result = await Dispatch(request.Url?.AbsolutePath ?? "", body);
                        await WriteJson(response, result);
                    }
                    finally { ReaderLock.Release(); }
                }
                catch (Exception error)
                {
                    response.StatusCode = 400;
                    await WriteJson(response, new { error = error.Message });
                }
                finally { response.Close(); }
            });
        }
    }

    private static async Task WriteJson(HttpListenerResponse response, object value)
    {
        response.ContentType = "application/json";
        await response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, JsonOptions)));
    }
}
