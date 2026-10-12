import type { Metadata } from "next";
import { AppPrivacyPolicyPage, type PrivacyPolicySection } from "@/components/app-privacy-policy";

export const metadata: Metadata = {
  title: "Volunteer App Privacy Policy — Race Upshot",
  description: "Privacy information for the Race Upshot Volunteer race-operations app.",
};

const sections: PrivacyPolicySection[] = [
  {
    title: "Information this app uses",
    paragraphs: ["The Volunteer app is provided to assigned race volunteers and staff. It uses information supplied by Race Upshot, the event organizer, or the volunteer to authenticate the user and carry out assigned race-day tasks."],
    bullets: [
      "Volunteer name, assigned email address, event assignment, role, and sign-in or session records.",
      "Race-operation records such as check-in, waiver status, athlete-band or timing-chip assignment, bike check-in/out, BIB and scanned code, manual timing stamps, and the volunteer account and time associated with an action.",
      "Participant and event details shown to a volunteer when needed for the assigned task, which may include athlete name, BIB, category, contact details, waiver status, and event status.",
      "A device push token if notifications are enabled, plus limited technical and request information needed to secure and troubleshoot the service."
    ],
  },
  {
    title: "Camera and location",
    paragraphs: ["Camera permission is used when a volunteer opens a scanner to read an athlete band, BIB, or timing-chip barcode. The normal scan flow processes the code for the requested race operation; it does not record or upload camera photos or video. The app does not request precise device location or continuously collect GPS data."],
  },
  {
    title: "How we use information",
    paragraphs: ["We use information to verify assigned volunteers, restrict access to their assigned events and roles, record race-day actions, support check-in and equipment workflows, maintain timing and audit records, deliver operational notices, protect the service, and resolve race-operation questions."],
  },
  {
    title: "Authentication and device storage",
    paragraphs: ["Volunteer sign-in may use an assigned password or a one-time code sent to the assigned email address. The app stores a session token on the device using platform secure storage and sends it to authenticate authorized requests. Do not share your sign-in code or session access with another person."],
  },
  {
    title: "Notifications and sharing",
    paragraphs: ["If you allow push notifications, a device token may be registered to deliver event-operation notices. You can disable notifications in your device settings. Volunteer and participant information is shared with the event organizer and authorized race staff, and with service providers that host or deliver authentication, email, push notifications, and app services. We do not sell personal information. Information may also be disclosed where required by law or needed to protect race participants and service security."],
  },
  {
    title: "Retention and requests",
    paragraphs: ["Volunteer account information is kept while needed to administer access. Race-operation logs, waiver/check-in status, and timing or equipment records may be retained by Race Upshot or the event organizer for event administration, result verification, audit, security, and legal requirements. Retention depends on the event and applicable obligations; no fixed deletion period is promised here. To request access, correction, or deletion of volunteer account information, email info@raceupshot.com. For participant records supplied by an organizer, contact that organizer as well. Certain race records may need to remain available to preserve event history and timing integrity."],
  },
  {
    title: "Children",
    paragraphs: ["The Volunteer app is intended for assigned adult volunteers and race staff. If a minor has been given access or their information is present in error, contact the event organizer and Race Upshot."],
  },
  {
    title: "Security, transfers, and changes",
    paragraphs: ["Access is limited by volunteer authentication and event/role assignments. We use reasonable technical and organizational safeguards, but no online service can guarantee absolute security. Service providers may process information outside your home state or country, subject to applicable safeguards. We may update this notice; the updated date above shows when it was last revised."],
  },
  {
    title: "Contact",
    paragraphs: ["For privacy questions or requests about the Volunteer app, email info@raceupshot.com. For an event-specific request, you may also contact the event organizer."],
  },
];

export default function VolunteerPrivacyPolicyPage() {
  return (
    <AppPrivacyPolicyPage
      appName="Race Upshot Volunteer"
      summary="How the race-operations app handles volunteer, participant, check-in, equipment, timing, and device information."
      sections={sections}
      otherPolicyHref="/privacy/tracking"
      otherPolicyLabel="Tracking app privacy policy"
    />
  );
}
