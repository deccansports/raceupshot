import { describe, expect, it } from "vitest";
import { suggestedMappings } from "../components/import-flow";

describe("participant spreadsheet mapping", () => {
  it("recognizes the Sprint Triathlon sheet columns without manual selection", () => {
    const mappings = suggestedMappings(["BIB Number", "Name on bib", "Name", "CONTEST", "Gender", "Email", "Mobile Number", "Birth Date", "Age", "T-Shirt", "Blood Group", "Medical History", "Medical Condition", "Emergency Contact Name", "Emergency Contact Number"]);
    expect(mappings).toMatchObject({
      bib: "BIB Number", nameOnBib: "Name on bib", name: "Name", category: "CONTEST",
      gender: "Gender", email: "Email", mobile: "Mobile Number", dateOfBirth: "Birth Date",
      age: "Age", tshirtSize: "T-Shirt", bloodGroup: "Blood Group",
      medicalHistory: "Medical History", medicalCondition: "Medical Condition",
      emergencyContactName: "Emergency Contact Name", emergencyContact: "Emergency Contact Number",
    });
  });
});
