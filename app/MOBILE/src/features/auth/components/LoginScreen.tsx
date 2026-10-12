import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Animated, Linking, Platform, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/core/auth";
import { APPLE_REVIEW_OTP, isAppleReviewLogin } from "@/core/auth/appleReview";
import { useTheme } from "@/core/theme";
import { Button, Icon, Input, Screen, Text } from "@/shared/components";

const emailForm = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});
type EmailForm = z.infer<typeof emailForm>;

const codeForm = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
type CodeForm = z.infer<typeof codeForm>;

const passwordForm = z.object({
  password: z.string().min(1, "Enter your password"),
});
type PasswordForm = z.infer<typeof passwordForm>;

const logo = require("../../../../assets/images/bm.png");

function cleanOtp(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function canGoBack(): boolean {
  if (Platform.OS !== "web") {
    return true;
  }
  return typeof window !== "undefined" && window.history.length > 1;
}

/**
 * Password login with email OTP as the recovery login method:
 * send-email-otp → verify-email-otp → Firebase custom token → signInWithCustomToken.
 */
export function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const [shake] = useState(() => new Animated.Value(0));
  const [loginMethod, setLoginMethod] = useState<"otp" | "password">(
    "password",
  );

  const emailFormApi = useForm<EmailForm>({
    resolver: zodResolver(emailForm),
    defaultValues: { email: "" },
  });
  const otpForm = useForm<CodeForm>({
    resolver: zodResolver(codeForm),
    defaultValues: { code: "" },
  });
  const passwordFormApi = useForm<PasswordForm>({
    resolver: zodResolver(passwordForm),
    defaultValues: { password: "" },
  });
  const enteredEmail = useWatch({
    control: emailFormApi.control,
    name: "email",
  });
  const showAppleReviewHelp = isAppleReviewLogin(
    auth.step === "verify" ? auth.email : enteredEmail,
  );
  const resendLabel = useMemo(() => {
    if (auth.resendCooldownSeconds > 0)
      return `RESEND CODE (${auth.resendCooldownSeconds}s)`;
    return "RESEND CODE";
  }, [auth.resendCooldownSeconds]);

  useEffect(() => {
    if (!auth.error || auth.step !== "verify") return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, {
        toValue: -8,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shake, {
        toValue: 8,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shake, {
        toValue: -6,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shake, {
        toValue: 6,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shake, {
        toValue: 0,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, [auth.error, auth.step, shake]);

  const submitEmail = emailFormApi.handleSubmit(async ({ email }) => {
    try {
      console.log("[auth-ui] requestOtp:start", { email });
      await auth.requestOtp(email);
      console.log("[auth-ui] requestOtp:complete");
    } catch (error) {
      console.error("[auth-ui] requestOtp error", error);
      if (error instanceof Error && error.stack) console.error(error.stack);
    }
  });

  const submitCode = otpForm.handleSubmit(async ({ code }) => {
    try {
      console.log("[auth-ui] verifyOtp:start");
      const ok = await auth.verifyOtp(code);
      console.log("[auth-ui] verifyOtp:result", ok);
      if (ok) {
        console.log("[auth-ui] navigation:start");
        router.replace("/(tabs)/dashboard");
        console.log("[auth-ui] navigation:complete");
      }
    } catch (error) {
      console.error("[auth-ui] verifyOtp error", error);
      if (error instanceof Error && error.stack) console.error(error.stack);
    }
  });

  const submitPassword = passwordFormApi.handleSubmit(async ({ password }) => {
    const emailIsValid = await emailFormApi.trigger("email");
    if (!emailIsValid) return;

    try {
      const email = emailFormApi.getValues("email");
      console.log("[auth-ui] passwordLogin:start", { email });
      const ok = await auth.signInWithPassword(email, password);
      console.log("[auth-ui] passwordLogin:result", ok);
      if (ok) {
        console.log("[auth-ui] navigation:start");
        router.replace("/(tabs)/dashboard");
        console.log("[auth-ui] navigation:complete");
      }
    } catch (error) {
      console.error("[auth-ui] passwordLogin error", error);
      if (error instanceof Error && error.stack) console.error(error.stack);
    }
  });

  const handleBackPress = () => {
    if (canGoBack()) router.back();
    else router.replace("/");
  };

  if (auth.accountRequired) {
    return (
      <Screen scroll>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={handleBackPress}
          style={{ marginBottom: theme.spacing.lg }}
        >
          <Icon name="chevronLeft" />
        </Pressable>

        <View
          style={{
            alignItems: "center",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.xl,
          }}
        >
          <Image
            source={logo}
            style={{ width: 112, height: 112 }}
            contentFit="contain"
          />
          <Text variant="title" center>
            Account required
          </Text>
          <Text variant="body" color="textMuted" center>
            {auth.accountRequired.message}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.base }}>
          <Button
            label="Open Bergman Website"
            fullWidth
            onPress={() => {
              void Linking.openURL("https://bergmantri.com");
            }}
          />
          <Button
            label="Try Again"
            variant="secondary"
            fullWidth
            loading={auth.pending}
            onPress={() => {
              if (auth.email) {
                void auth.requestOtp(auth.email);
                return;
              }
              auth.backToRequest();
            }}
          />
          <Button
            label="Back to Login"
            variant="ghost"
            fullWidth
            onPress={() => {
              otpForm.reset({ code: "" });
              auth.backToRequest();
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        onPress={handleBackPress}
        style={{ marginBottom: theme.spacing.lg }}
      >
        <Icon name="chevronLeft" />
      </Pressable>

      <View
        style={{
          alignItems: "center",
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.xl,
        }}
      >
        <Image
          source={logo}
          style={{ width: 112, height: 112 }}
          contentFit="contain"
        />
        <Text variant="title">
          {loginMethod === "password"
            ? "Log in with password"
            : auth.step === "request"
              ? "Log in with OTP"
              : "Verify code"}
        </Text>
        <Text variant="body" color="textMuted" center>
          {loginMethod === "password"
            ? "Enter your email and password to continue."
            : auth.step === "request"
              ? "Enter your email and we’ll send you a one-time code."
              : `Enter the 6-digit code sent to ${auth.email}.`}
        </Text>
      </View>

      {loginMethod === "password" ? (
        <View style={{ gap: theme.spacing.base }}>
          <Controller
            control={emailFormApi.control}
            name="email"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label="Email address"
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={emailFormApi.formState.errors.email?.message}
              />
            )}
          />
          <Controller
            control={passwordFormApi.control}
            name="password"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label="Password"
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete={Platform.OS === "web" ? "off" : "password"}
                editable={!auth.pending}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={passwordFormApi.formState.errors.password?.message}
              />
            )}
          />
          {auth.error ? (
            <Text variant="bodySmall" color="danger">
              {auth.error}
            </Text>
          ) : null}
          <Button
            label="Log in"
            fullWidth
            loading={auth.pending}
            onPress={submitPassword}
          />
          <View style={{ alignItems: "center", gap: theme.spacing.sm }}>
            <Text variant="bodySmall" color="textMuted">
              Don&apos;t remember your password?
            </Text>
            <Button
              label="Log in with OTP"
              variant="ghost"
              fullWidth
              onPress={() => {
                setLoginMethod("otp");
                auth.backToRequest();
                auth.clearAccountRequired();
              }}
            />
          </View>
        </View>
      ) : auth.step === "request" ? (
        <View style={{ gap: theme.spacing.base }}>
          <Controller
            control={emailFormApi.control}
            name="email"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label="Email address"
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={emailFormApi.formState.errors.email?.message}
              />
            )}
          />
          {showAppleReviewHelp ? (
            <Text variant="bodySmall" color="textMuted">
              For Apple App Review, use OTP {APPLE_REVIEW_OTP}.
            </Text>
          ) : null}
          {auth.error ? (
            <Text variant="bodySmall" color="danger">
              {auth.error}
            </Text>
          ) : null}
          <Button
            label="Send OTP"
            fullWidth
            loading={auth.pending}
            onPress={submitEmail}
          />
          <Button
            label="Log in with password"
            variant="ghost"
            fullWidth
            onPress={() => {
              setLoginMethod("password");
              auth.backToRequest();
              auth.clearAccountRequired();
            }}
          />
        </View>
      ) : (
        <View style={{ gap: theme.spacing.base }}>
          <Controller
            control={otpForm.control}
            name="code"
            render={({ field: { value, onBlur } }) => (
              <Animated.View style={{ transform: [{ translateX: shake }] }}>
                <Input
                  label="One-time code"
                  placeholder="000000"
                  autoFocus
                  keyboardType={
                    Platform.OS === "web" ? "numeric" : "number-pad"
                  }
                  inputMode="numeric"
                  enterKeyHint="done"
                  textContentType={
                    Platform.OS === "ios" ? "oneTimeCode" : "none"
                  }
                  autoComplete={Platform.OS === "web" ? "off" : "sms-otp"}
                  importantForAutofill="no"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!auth.pending}
                  maxLength={6}
                  value={value}
                  onChangeText={(t) => {
                    otpForm.setValue("code", cleanOtp(t), {
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }}
                  onBlur={onBlur}
                  error={auth.error || otpForm.formState.errors.code?.message}
                />
              </Animated.View>
            )}
          />
          {showAppleReviewHelp ? (
            <Text variant="bodySmall" color="textMuted">
              For Apple App Review, use OTP {APPLE_REVIEW_OTP}.
            </Text>
          ) : null}
          {auth.info ? (
            <Text variant="bodySmall" color="textMuted">
              {auth.info}
            </Text>
          ) : null}
          <Button
            label="Verify & continue"
            fullWidth
            loading={auth.pending}
            onPress={submitCode}
          />
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend code"
              onPress={() => {
                if (auth.resendCooldownSeconds > 0) return;
                void auth.resendOtp();
                otpForm.reset({ code: "" });
              }}
              hitSlop={8}
            >
              <Text variant="label" color="accent">
                {resendLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change email"
              onPress={() => {
                otpForm.reset({ code: "" });
                auth.backToRequest();
              }}
              hitSlop={8}
            >
              <Text variant="label" color="textSecondary">
                CHANGE EMAIL
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  );
}
