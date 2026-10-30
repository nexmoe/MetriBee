"use client";

import { AuthError } from "@/components/auth/AuthError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";
import React, { Suspense, useState } from "react";
import { RybbitLogo, RybbitTextLogo } from "../../components/RybbitLogo";

import { useSetPageTitle } from "../../hooks/useSetPageTitle";
import { authClient } from "../../lib/auth";
import { useConfigs } from "../../lib/configs";
import { IS_CLOUD } from "../../lib/const";
import { userStore } from "../../lib/userStore";
import { cn } from "../../lib/utils";
import { AccountStep } from "./components/AccountStep";
import { completeSignupWorkspace } from "../../../../adapter/accounts/onboarding";
import { actualHref } from "../../../../adapter/navigation";
import { SetupStep } from "./components/SetupStep";

function SignupPageContent() {
  const { configs, isLoading: isLoadingConfigs } = useConfigs();
  useSetPageTitle("Signup");
  const t = useExtracted();

  const maxStep = 2;
  const [stepParam, setStepParam] = useQueryState("step", parseAsInteger);
  const [currentStep, setCurrentStepRaw] = useState(stepParam && stepParam >= 1 && stepParam <= maxStep ? stepParam : 1);

  // Wrap setCurrentStep to also update the URL param
  const setCurrentStep = (step: number) => {
    setCurrentStepRaw(step);
    setStepParam(step);
  };
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // Step 1: Account creation
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>("");

  // Setup: Organization (GA4 properties are synchronized by the server)
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [referralSource, setReferralSource] = useState("");

  const handleOrgNameChange = (value: string) => {
    setOrgName(value);
    if (value) {
      const generatedSlug = value
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      setOrgSlug(generatedSlug || `org-${crypto.randomUUID().slice(0, 8)}`);
    }
  };

  // Step 1: Account creation submission
  const handleAccountSubmit = async () => {
    setIsLoading(true);
    setError("");

    try {
      const { data, error } = await authClient.signUp.email(
        {
          email,
          name: email.split("@")[0],
          password,
        },
        {
          onRequest: context => {
            if (IS_CLOUD && turnstileToken) {
              context.headers.set("x-captcha-response", turnstileToken);
            }
          },
        }
      );

      if ((data as { redirect?: boolean } | null)?.redirect) return;
      if (data?.user) {
        userStore.setState({ user: data.user });
        window.location.assign(actualHref("/signup?step=2"));
      }

      if (error) {
        setError(error.message ?? "");
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Configure the workspace, then open its synchronized GA4 properties.
  const handleSetupSubmit = async () => {
    setIsLoading(true);
    setError("");

    try {
      await completeSignupWorkspace({ name: orgName, slug: orgSlug });
      window.location.assign(actualHref(IS_CLOUD ? '/settings/billing' : '/'));
    } catch (error) {
      setError(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  const steps = [
    { step: 1, label: t("Account") },
    { step: 2, label: t("Workspace") },
  ];

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <AccountStep
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            turnstileToken={turnstileToken}
            setTurnstileToken={setTurnstileToken}
            isLoading={isLoading}
            onSubmit={handleAccountSubmit}
            setError={setError}
          />
        );
      case 2:
        return (
          <SetupStep
            orgName={orgName}
            orgSlug={orgSlug}
            handleOrgNameChange={handleOrgNameChange}
            referralSource={referralSource}
            setReferralSource={setReferralSource}
            isLoading={isLoading}
            onSubmit={handleSetupSubmit}
          />
        );
      default:
        return null;
    }
  };

  if (isLoadingConfigs) {
    return null;
  }

  if (configs?.disableSignup && currentStep === 1) {
    return (
      <div className="flex justify-center items-center h-dvh w-full">
        <Card className="w-full max-w-sm p-1">
          <CardHeader>
            <RybbitLogo width={32} height={32} />
            <CardTitle className="text-2xl flex justify-center">{t("Sign Up Disabled")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-6">
              <p className="text-center">
                {t("New account registration is currently disabled. If you have an account, you can")}{" "}
                <Link href="/login" className="underline">
                  {t("sign in")}
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full justify-center">
      <div className="w-full max-w-[550px] flex flex-col p-6 lg:p-10">
        {/* Logo */}
        <div className="mb-8">
          <a href="/" className="inline-block">
            <RybbitTextLogo />
          </a>
        </div>

        <div className="flex-1 flex flex-col justify-center w-full max-w-[550px] mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-medium">
              {t("Get started with MetriBee")}
            </h1>
            {IS_CLOUD && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-3">
                {t("Start collecting analytics in minutes")}
              </p>
            )}
          </div>

          {/* Horizontal step indicator */}
          <div className="flex items-center w-full mb-8">
            {steps.map(({ step, label }, index, arr) => (
              <React.Fragment key={step}>
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all duration-300",
                      currentStep === step
                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
                        : currentStep > step
                          ? "bg-emerald-600 text-white"
                          : "bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
                    )}
                  >
                    {currentStep > step ? <Check className="h-4 w-4" /> : step}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium transition-colors duration-300",
                      currentStep >= step
                        ? "text-neutral-900 dark:text-neutral-100"
                        : "text-neutral-400 dark:text-neutral-500"
                    )}
                  >
                    {label}
                  </span>
                </div>
                {index < arr.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-0.5 mx-3 mb-6 transition-all duration-300 rounded-full",
                      currentStep > step ? "bg-emerald-600" : "bg-neutral-200 dark:bg-neutral-800"
                    )}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Content area */}
          <div className="flex flex-col gap-4">
            {renderStepContent()}
            <AuthError error={error} />
          </div>
        </div>

        {!IS_CLOUD && (
          <div className="text-xs text-muted-foreground mt-8">
            <a
              href="https://github.com/nexmoe/MetriBee"
              target="_blank"
              rel="noopener"
              title="MetriBee - Open Source Google Analytics 4 Dashboard"
            >
              {t("Open source web analytics powered by MetriBee")}
            </a>
          </div>
        )}
      </div>


    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageContent />
    </Suspense>
  );
}
