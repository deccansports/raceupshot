import { Redirect } from 'expo-router';

import { env } from '@/core/constants/env';
import { ComponentShowcase } from '@/shared/showcase';

export default function ShowcaseRoute() {
	if (env.environment === 'production') {
		return <Redirect href="/" />;
	}
	return <ComponentShowcase />;
}
