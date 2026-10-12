import { describe, expect, it } from "vitest";
import { buildBergtecnoTemplatePayloads } from "../lib/bergtecno-email";
import { buildFinisherWhatsAppComponents, normalizeWhatsAppNumber } from "../lib/bergtecno-whatsapp";
import { buildResultEmailTemplateVariables, finisherNotificationKey } from "../lib/result-emails";
import { applyImportedResultColumnMappings, buildImportedResultTiming, normalizeImportedResultStatus } from "../lib/raceupshot-repository";

describe("result import status normalization", () => {
  it.each([
    ["Did Not Start", "DNS"],
    ["DNF", "DNF"],
    ["DNQ", "DNQ"],
    ["Did Not Qualify", "DNQ"],
    ["DQ", "DSQ"],
    ["Disqualified", "DSQ"],
    ["Out of time limit", "OTL"],
    ["Completed", "FINISHED"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeImportedResultStatus(input, 0)).toBe(expected);
  });

  it("uses timing presence for a blank spreadsheet status", () => {
    expect(normalizeImportedResultStatus("", 3_601)).toBe("FINISHED");
    expect(normalizeImportedResultStatus("", 0)).toBe("DNS");
  });

  it("normalizes running chip/gun time and triathlon discipline columns", () => {
    expect(buildImportedResultTiming({
      "Chip Time": "01:20:30",
      "Gun Time": "01:21:00",
    })).toMatchObject({ overallTime: 4_830, gunTime: 4_860 });

    expect(buildImportedResultTiming({
      Swim: "00:20:00",
      T1: "00:02:00",
      Bike: "01:00:00",
      T2: "00:01:30",
      Run: "00:40:00",
      "Chip Time": "02:03:30",
    }).splits).toEqual([
      { name: "Swim", time: 1_200 },
      { name: "T1", time: 1_320 },
      { name: "Bike", time: 4_920 },
      { name: "T2", time: 5_010 },
      { name: "Run", time: 7_410 },
    ]);
  });

  it("supports Excel time cells serialized as ISO date-time values", () => {
    expect(buildImportedResultTiming({
      "Chip Time": "1899-12-30T07:57:02.000Z",
      Swim: "1899-12-30T00:55:41.000Z",
    })).toMatchObject({
      overallTime: 28_622,
      splits: [{ name: "Swim", time: 3_341 }],
    });
  });

  it("does not let a legacy zero canonical field hide the sheet time", () => {
    expect(buildImportedResultTiming({
      "Chip Time": "07:57:02",
      chipTime: 0,
      overallTime: 0,
    }).overallTime).toBe(28_622);
  });

  it("maps custom spreadsheet headers into canonical result fields", () => {
    const row = applyImportedResultColumnMappings({ "Runner Code": "B-42", "Participant Full Name": "Asha Rao", "Net Duration": "01:05:10" }, {
      bib: "Runner Code",
      name: "Participant Full Name",
      chipTime: "Net Duration",
    });
    expect(row).toMatchObject({ "Bib Number": "B-42", Name: "Asha Rao", "Chip Time": "01:05:10" });
    expect(buildImportedResultTiming(row).overallTime).toBe(3_910);
  });

  it("maps leg, transition, and checkpoint columns and prefers explicit splits", () => {
    const row = applyImportedResultColumnMappings({
      "Swim Duration": "00:20:00",
      "Transition One": "00:02:00",
      "Cycle Duration": "01:00:00",
      "Transition Two": "00:01:30",
      "Run Duration": "00:40:00",
      "Start Elapsed": "00:00:30",
      "Swim Exit": "00:20:30",
      "Bike Out": "00:22:30",
      "Bike In": "01:22:30",
      "Run Out": "01:24:00",
      "Finish Elapsed": "02:04:00",
    }, {
      swim: "Swim Duration",
      t1: "Transition One",
      bike: "Cycle Duration",
      t2: "Transition Two",
      run: "Run Duration",
      startSplit: "Start Elapsed",
      swimFinishSplit: "Swim Exit",
      bikeStartSplit: "Bike Out",
      bikeFinishSplit: "Bike In",
      runStartSplit: "Run Out",
      finishSplit: "Finish Elapsed",
    });
    const timing = buildImportedResultTiming(row);
    expect(timing.legs).toEqual([
      { name: "Swim", time: 1_200 },
      { name: "T1", time: 120 },
      { name: "Bike", time: 3_600 },
      { name: "T2", time: 90 },
      { name: "Run", time: 2_400 },
    ]);
    expect(timing.splits).toEqual([
      { name: "Start", time: 30 },
      { name: "Swim Finish", time: 1_230 },
      { name: "Bike Start", time: 1_350 },
      { name: "Bike Finish", time: 4_950 },
      { name: "Run Start", time: 5_040 },
      { name: "Race Finish", time: 7_440 },
    ]);
  });
});

describe("Bergtecno result template parameters", () => {
  it("includes the snake-case params referenced by template 18", () => {
    const variables = buildResultEmailTemplateVariables({
      id: "1002",
      email: "athlete@example.com",
      name: "Vaibhav Bel",
      bib: "1002",
      category: "10 K Marathon",
      finishTime: "01:02:03",
      overallRank: "4",
      genderRank: "3",
      categoryRank: "2",
      gender: "Male",
      legTimes: [
        { name: "5 KM", time: 1_500 },
        { name: "10 KM", time: 1_480 },
      ],
    }, {
      name: "Test 1234",
      slug: "test1",
      date: "30 Jul 2026",
      location: "Kolhapur",
    });

    expect(variables).toMatchObject({
      finish_time: "01:02:03",
      overall_rank: "4",
      gender_rank: "3",
      category_rank: "2",
      event_name: "Test 1234",
      athlete_name: "Vaibhav Bel",
      bib_number: "1002",
      eventName: "Test 1234",
      athleteName: "Vaibhav Bel",
      bib: "1002",
      race_breakdown: "5 KM: 00:25:00 • 10 KM: 00:24:40",
    });
  });

  it("passes the universal finisher template fields through Bergtecno params", () => {
    const variables = buildResultEmailTemplateVariables({
      id: "runner-42",
      email: "runner@example.com",
      name: "Asha Rao",
      bib: "B-42",
      category: "Half Marathon",
      finishTime: "01:52:03.450",
      overallRank: "",
      genderRank: "",
      categoryRank: "",
      gender: "Female",
      legTimes: [{ name: "10 KM", time: 3_100 }, { name: "Finish", time: 3_623 }],
    }, { name: "City Run", slug: "city-run" });
    expect(variables).toMatchObject({ finishTime: "01:52:03", finish_time: "01:52:03" });
    const [payload] = buildBergtecnoTemplatePayloads({
      recipientEmail: "runner@example.com",
      templateId: "template-id",
      variables,
      senderEmail: "info@raceupshot.com",
      senderName: "Race Upshot",
    });
    const params = (payload.params as Record<string, unknown>).params as Record<string, unknown>;

    expect(params).toMatchObject({
      eventName: "City Run",
      athleteName: "Asha Rao",
      bib: "B-42",
      finish_time: "01:52:03",
      race_breakdown: "10 KM: 00:51:40 • Finish: 01:00:23",
    });
  });

  it("nests variables for Bergtecno params expressions", () => {
    const [payload] = buildBergtecnoTemplatePayloads({
      recipientEmail: "INFO@DSCORG.IN",
      templateId: "5516589c-c988-4768-bf44-c4a49d5912c8",
      variables: {
        finish_time: "07:57:02",
        overall_rank: "104",
        gender_rank: "95",
        category_rank: "12",
      },
      senderEmail: "info@raceupshot.com",
      senderName: "Race Upshot",
    });
    const params = payload.params as Record<string, unknown>;

    expect(payload.to).toEqual([{ email: "info@dscorg.in" }]);
    expect(params.finish_time).toBe("07:57:02");
    expect((params.params as Record<string, unknown>).finish_time).toBe("07:57:02");
    expect((payload.variables as Record<string, unknown>).overall_rank).toBe("104");
  });

  it("preserves the provider's case-sensitive OTP variable for check-in template #31", () => {
    const [payload] = buildBergtecnoTemplatePayloads({
      recipientEmail: "athlete@example.com",
      templateId: "4816d386-8040-42d6-b2c9-c08a803c6f49",
      variables: { OTP: "012345", NAME: "Asha Runner" },
      senderEmail: "info@raceupshot.com",
      senderName: "Race Upshot",
    });

    expect(payload.templateId).toBe("4816d386-8040-42d6-b2c9-c08a803c6f49");
    expect((payload.params as Record<string, unknown>).OTP).toBe("012345");
    expect((payload.params as Record<string, unknown>).NAME).toBe("Asha Runner");
    expect((payload.params as Record<string, unknown>).otp).toBeUndefined();
  });
});

describe("Bergtecno finisher WhatsApp delivery", () => {
  it("normalizes Indian mobile numbers and rejects invalid destinations", () => {
    expect(normalizeWhatsAppNumber("98765 43210")).toBe("+919876543210");
    expect(normalizeWhatsAppNumber("+44 7700 900123")).toBe("+447700900123");
    expect(normalizeWhatsAppNumber("123")).toBe("");
  });

  it("builds ordered template body parameters and channel-scoped delivery keys", () => {
    expect(buildFinisherWhatsAppComponents(["Asha", "Test 1234", "B-42"])).toEqual([{
      type: "body",
      parameters: ["Asha", "Test 1234", "B-42"].map((text) => ({ type: "text", text })),
    }]);
    expect(finisherNotificationKey("event-1", "bib:42", "EMAIL")).toBe("raceupshot:notification:results:event-1:bib%3A42:email");
    expect(finisherNotificationKey("event-1", "bib:42", "WHATSAPP")).toBe("raceupshot:notification:results:event-1:bib%3A42:whatsapp");
  });
});
