import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useTheme } from '@/core/theme';
import { Button, Card, Icon, Screen, Text } from '@/shared/components';

type LegalSection = {
  title: string;
  body?: string;
  bullets?: string[];
};

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: '1. Introduction',
    body: 'BERGMAN Race ("we", "our", "us") respects your privacy and is committed to protecting your personal information.\n\nThis Privacy Policy explains how information is collected, used, stored, and shared when you use the BERGMAN Race mobile application and related services.',
  },
  {
    title: '2. Information We Collect',
    body: 'We may collect:\n\nAccount Information',
    bullets: [
      'Name',
      'Email address',
      'Phone number',
      'Athlete ID',
      'Club affiliation',
      'Country',
      'City',
      'Profile photo (optional)',
    ],
  },
  {
    title: 'Registration Information',
    body: 'When you register for an event:',
    bullets: [
      'Event registrations',
      'Bib number',
      'Race category',
      'Gender',
      'Age group',
      'Emergency contact (if provided)',
    ],
  },
  {
    title: 'Live Tracking Data',
    body: 'During an event:',
    bullets: [
      'Timing chip reads',
      'Split times',
      'Rankings',
      'Estimated athlete position',
      'Race progress',
      'Official results',
      'GPS location is not continuously collected from your phone unless explicitly enabled for a future feature.',
    ],
  },
  {
    title: '3. How We Use Information',
    body: 'We use your information to:',
    bullets: [
      'Manage event registrations',
      'Display live tracking',
      'Publish race results',
      'Provide athlete rankings',
      'Deliver notifications',
      'Improve app performance',
      'Prevent fraud',
      'Respond to support requests',
    ],
  },
  {
    title: '4. Live Tracking Visibility',
    body: 'Athletes control how they appear during each event.\n\nAvailable settings:\n\nPublic\n\nYour identity and race progress are visible.\n\nAnonymous\n\nRace data remains visible but your identity is replaced with:\n\nAnonymous Athlete\n\nYour name, profile photo, club, and location are hidden.\n\nPrivate\n\nYour live tracking information is hidden from public viewers.\n\nOfficial race results may still be published after the event according to event rules.',
  },
  {
    title: '5. Profile Photos',
    body: 'If you upload a profile photo:',
    bullets: [
      'it is associated with your athlete profile',
      'it may appear in leaderboards and athlete tracking when your visibility is Public',
      'it is hidden automatically when Anonymous or Private visibility is selected',
    ],
  },
  {
    title: '6. Results',
    body: 'Official race results are stored after an event and may include:',
    bullets: [
      'Name',
      'Bib number',
      'Club',
      'Country',
      'Finish time',
      'Rankings',
      'Split times',
      'Results become part of the historical race record.',
    ],
  },
  {
    title: '7. Sponsors',
    body: 'The app may display sponsor logos, advertisements, promotional banners, and partner information associated with specific events.\n\nSponsors do not receive your personal information unless you explicitly consent.',
  },
  {
    title: '8. Notifications',
    body: 'If enabled, the app may send notifications for:',
    bullets: [
      'Race start',
      'Swim exit',
      'Bike finish',
      'Run finish',
      'Finish time',
      'Event announcements',
      'You may disable notifications through your device settings.',
    ],
  },
  {
    title: '9. Data Storage',
    body: 'Race and athlete information may be securely stored using cloud infrastructure including:',
    bullets: [
      'BERGMAN backend services',
      'Cloudflare',
      'Firebase',
      'Secure cloud storage',
      'Appropriate security measures are implemented to protect your data.',
    ],
  },
  {
    title: '10. Sharing Information',
    body: 'We do not sell personal information.\n\nInformation may be shared only:',
    bullets: [
      'with race organizers',
      'timing partners',
      'emergency services when legally required',
      'government authorities where required by law',
    ],
  },
  {
    title: '11. Security',
    body: 'We use reasonable administrative and technical safeguards to protect your information.\n\nHowever, no internet transmission is completely secure.',
  },
  {
    title: "12. Children's Privacy",
    body: 'The app may be used by junior athletes participating in events with parental or guardian consent where required.',
  },
  {
    title: '13. Your Rights',
    body: 'Depending on your jurisdiction, you may request:',
    bullets: [
      'access to your data',
      'correction of inaccurate data',
      'deletion of your account (subject to race record requirements)',
      'withdrawal of consent where applicable',
    ],
  },
  {
    title: '14. Changes',
    body: 'This Privacy Policy may be updated periodically.\n\nContinued use of the app indicates acceptance of the updated policy.',
  },
  {
    title: '15. Contact',
    body: 'BERGMAN Race\n\nContact support through the app or your event organizer.',
  },
];

const TERMS_SECTIONS: LegalSection[] = [
  {
    title: '1. Acceptance',
    body: 'By using BERGMAN Race, you agree to these Terms of Service.\n\nIf you do not agree, please discontinue use of the application.',
  },
  {
    title: '2. Purpose',
    body: 'BERGMAN Race provides:',
    bullets: [
      'Live athlete tracking',
      'Event information',
      'Leaderboards',
      'Results',
      'Replay',
      'Athlete profiles',
      'Event notifications',
    ],
  },
  {
    title: '3. Athlete Accounts',
    body: 'Athletes are responsible for ensuring that registration information is accurate.\n\nYou are responsible for maintaining the confidentiality of your account credentials.',
  },
  {
    title: '4. Live Tracking',
    body: "Timing information is provided for informational purposes.\n\nEstimated positions, predictions, and replay animations may not exactly reflect an athlete's real-world location.\n\nOfficial timing data always takes precedence.",
  },
  {
    title: '5. Official Results',
    body: 'Official race results are determined solely by the official timing provider and race officials.\n\nThe app displays official results as supplied by the event timing system.',
  },
  {
    title: '6. Athlete Privacy',
    body: 'Athletes may choose:\n\nPublic\nAnonymous\nPrivate\n\nThese settings affect live tracking visibility only. Race organizers may still publish official results in accordance with event rules.',
  },
  {
    title: '7. User Conduct',
    body: 'Users agree not to:\n\ninterfere with the service\nattempt unauthorized access\nscrape or copy data in bulk\nupload malicious software\nimpersonate another athlete\nmisuse race information',
  },
  {
    title: '8. Intellectual Property',
    body: 'All content including:\n\nlogos\nbranding\ngraphics\nsoftware\nmaps\ntiming interfaces\n\nare owned by BERGMAN Race or respective licensors. Unauthorized reproduction is prohibited.',
  },
  {
    title: '9. Third-Party Services',
    body: 'The application may integrate with third-party services including mapping providers, notification services, cloud infrastructure, and timing systems.\n\nTheir respective terms and privacy policies also apply.',
  },
  {
    title: '10. Availability',
    body: 'We strive for high availability but do not guarantee uninterrupted service.\n\nLive tracking depends on:\n\ntiming hardware\nnetwork connectivity\ncloud infrastructure\nGPS and mapping services\nTemporary outages may occur.',
  },
  {
    title: '11. Limitation of Liability',
    body: 'BERGMAN Race is provided "as is."\n\nTo the maximum extent permitted by law, BERGMAN Race, Deccan Sports Club, event organizers, timing partners, sponsors, and affiliates are not liable for indirect, incidental, or consequential damages arising from the use of the application.',
  },
  {
    title: '12. Event Information',
    body: 'Schedules, routes, timing points, and event information may change without prior notice.\n\nAlways follow instructions issued by race officials.',
  },
  {
    title: '13. Termination',
    body: 'We may suspend or terminate access for users who violate these Terms or misuse the platform.',
  },
  {
    title: '14. Governing Law',
    body: 'These Terms are governed by the applicable laws of the jurisdiction in which the event organizer operates, unless otherwise required by local law.',
  },
];

function BackHeader({ title }: { title: string }) {
  const theme = useTheme();
  const router = useRouter();
  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/settings');
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Button label="Back" variant="ghost" size="sm" onPress={handleBackPress} />
      <Text variant="title" style={{ flex: 1 }}>
        {title}
      </Text>
    </View>
  );
}

function LegalSectionCard({ section }: { section: LegalSection }) {
  const theme = useTheme();

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <Text variant="label">{section.title}</Text>
      {section.body ? (
        <Text variant="body" color="textMuted">
          {section.body}
        </Text>
      ) : null}
      {section.bullets?.map((bullet) => (
        <View key={bullet} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Icon name="chevronRight" color="accent" size={16} />
          <Text variant="body" color="textMuted" style={{ flex: 1 }}>
            {bullet}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function LegalDocumentScreen({
  title,
  effectiveDate,
  sections,
}: {
  title: string;
  effectiveDate: string;
  sections: LegalSection[];
}) {
  const theme = useTheme();

  return (
    <Screen scroll contentStyle={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}>
      <BackHeader title={title} />
      <Card style={{ gap: theme.spacing.xs }}>
        <Text variant="headline">{title}</Text>
        <Text variant="bodySmall" color="textMuted">
          Effective Date: {effectiveDate}
        </Text>
      </Card>
      {sections.map((section) => (
        <LegalSectionCard key={section.title} section={section} />
      ))}
    </Screen>
  );
}

export function AboutScreen() {
  return (
    <Screen scroll contentStyle={{ gap: 16 }}>
      <BackHeader title="About us" />
      <Card style={{ gap: 8 }}>
        <Text variant="headline">About us</Text>
        <Text variant="body" color="textMuted">
          BERGMAN Race is the live timing and athlete experience platform for events operated by
          Deccan Sports Club and its partners.
        </Text>
      </Card>
    </Screen>
  );
}

export function SupportScreen() {
  return (
    <Screen scroll contentStyle={{ gap: 16 }}>
      <BackHeader title="Contact us" />
      <Card style={{ gap: 8 }}>
        <Text variant="headline">Contact us</Text>
        <Text variant="body" color="textMuted">
          Use the in-app support options or contact your event organizer for help with registration,
          timing, results, or account access.
        </Text>
      </Card>
    </Screen>
  );
}

export function PrivacyPolicyScreen() {
  return (
    <LegalDocumentScreen
      title="BERGMAN Race Privacy Policy"
      effectiveDate="July 2026"
      sections={PRIVACY_SECTIONS}
    />
  );
}

export function TermsOfServiceScreen() {
  return (
    <LegalDocumentScreen
      title="BERGMAN Race Terms of Service"
      effectiveDate="July 2026"
      sections={TERMS_SECTIONS}
    />
  );
}
