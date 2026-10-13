// global types

// 百度地图GL版本全局类型声明
/// <reference types="bmapgl" />

declare module 'mammoth/mammoth.browser' {
	const mammoth: {
		extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
	};
	export default mammoth;
}

interface Window {
	Paddle?: {
		Environment: {
			set(environment: 'sandbox' | 'production'): void;
		};
		Initialize(options: {
			token: string;
			eventCallback?: (event: { name: string }) => void;
		}): void;
		Checkout: {
			open(options: {
				items: Array<{ priceId: string; quantity: number }>;
				customer?: { email?: string };
				customData: {
					organization_id: string;
					organization_signature: string;
					tier: 'starter' | 'pro';
				};
			}): void;
		};
	};
}
