import type { Metadata } from "next";
import { AppPrivacyPolicyPage, type PrivacyPolicySection } from "@/components/app-privacy-policy";

export const metadata: Metadata = {
  title: "Tracking App Privacy Policy — Race Upshot",
  description: "Privacy information for the Race Upshot athlete tracking app.",
};

const sections: PrivacyPolicySection[] = [
  {
    title: "Information this app uses",
    paragraphs: ["Depending on the features you use, the app and Race Upshot services may process information you provide, information supplied by an event organizer or timing provider, and limited technical information needed to operate the service."],
    bullets: [
      "Account and profile details such as name, email address, phone number, athlete identity, club, country, city, and an optional profile image.",
      "Event and registration details such as event, race category, BIB, age group, gender, and emergency contact details where supplied for event operations.",
      "Race data such as timing reads, split and finish times, race status, rankings, results, and athletes or events you choose to follow.",
      "App and device information needed for sign-in, push notifications, service security, and troubleshooting. A push token is used only if you enable notifications."
    ],
  },
  {
    title: "Live tracking and location",
    paragraphs: ["The app does not request your phone's precise location permission or continuously collect GPS location. A displayed race position or progress estimate is derived from event timing reads, course information, and race data; it is not a continuous GPS feed from your phone."],
  },
  {
    title: "How athlete visibility works",
    paragraphs: ["Depending on event configuration, live race progress and identity may be displayed publicly. Where available, an athlete can select public or anonymous visibility for live tracking. Anonymous display hides identity in the live view, but timing data may remain visible. Official results may still be published by the organizer under event rules, and historical result records may be retained."],
  },
  {
    title: "How we use information",
    paragraphs: ["We use information to provide account and event features, show live timing and results, maintain watchlists and notification preferences, secure and troubleshoot the service, respond to requests, and support race operations and result verification."],
  },
  {
    title: "Notifications and device storage",
    paragraphs: ["If you grant notification permission, the app may register a device push token and send race alerts, athlete updates, or service notifications. You can turn notifications off in your device settings. Sign-in tokens and limited app preferences may be stored on your device using platform secure storage; watchlist data may be cached to support app use."],
  },
  {
    title: "Sharing and service providers",
    paragraphs: ["We do not sell personal information. Information is shared only as needed to provide the service, including with the event organizer and timing provider responsible for the relevant race, and with infrastructure, authentication, map, and notification providers. Information may also be disclosed where required to protect users, race integrity, or comply with law. Each provider processes information under its own applicable terms."],
  },
  {
    title: "Retention and your choices",
    paragraphs: ["We keep account, event, and race information for as long as needed to provide the service and maintain reliable official results, race-history, security, and audit records, or as otherwise required by law. You may request access, correction, or deletion by emailing info@raceupshot.com. Some event registration and official timing/result records may need to be retained or handled by the event organizer even if an account is closed. You may also contact the organizer about information it supplied."],
  },
  {
    title: "Children",
    paragraphs: ["Some events include junior athletes. An event organizer or parent/guardian should provide or manage a minor's event information where required. Please contact the organizer or Race Upshot if information about a child has been submitted in error or should be corrected."],
  },
  {
    title: "Security, transfers, and changes",
    paragraphs: ["We use reasonable technical and organizational safeguards, but no online service can guarantee absolute security. Our service providers may process information in locations outside your home state or country, subject to applicable safeguards. We may update this notice; the updated date above shows when it was last revised."],
  },
  {
    title: "Contact",
    paragraphs: ["For privacy questions or requests about the Tracking app, email info@raceupshot.com. For event registration or official result records, you may also contact the event organizer."],
  },
];

export default function TrackingPrivacyPolicyPage() {
  return (
    <AppPrivacyPolicyPage
      appName="Race Upshot Tracking"
      summary="How the athlete tracking app handles account, race, notification, and device information."
      sections={sections}
      otherPolicyHref="/privacy/volunteer"
      otherPolicyLabel="Volunteer app privacy policy"
    />
  );
}
