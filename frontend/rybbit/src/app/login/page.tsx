"use client";

import { AuthButton } from "@/components/auth/AuthButton";
import { AuthError } from "@/components/auth/AuthError";
import { AuthInput } from "@/components/auth/AuthInput";
import { SocialButtons } from "@/components/auth/SocialButtons";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RybbitTextLogo } from "../../components/RybbitLogo";
import { SpinningGlobe } from "../../../../adapter/accounts/SpinningGlobe";
import { actualHref } from "../../../../adapter/navigation";
import { useSetPageTitle } from "../../hooks/useSetPageTitle";
import { authClient } from "../../lib/auth";
import { useConfigs } from "../../lib/configs";
import { IS_CLOUD } from "../../lib/const";
import { userStore } from "../../lib/userStore";

function LoginPage() {
  const searchParams = useSearchParams();
  const requestedReturn = searchParams.get("returnTo") ?? "";
  const returnTo = /^\/\d+\/[a-f0-9]{12}\?claim=1$/i.test(requestedReturn)
    ? requestedReturn
    : "/";
  const { configs, isLoading: isLoadingConfigs } = useConfigs();
  useSetPageTitle("Login");
  const t = useExtracted();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    setError("");

    try {
      const { data, error } = await authClient.signIn.email({
        email,
        password,
      });
      if ((data as { redirect?: boolean } | null)?.redirect) return;
      if (data?.user) {
        userStore.setState({
          user: data.user,
        });
        window.location.assign(actualHref(returnTo));
      }

      if (error) {
        setError(error.message);
      }
    } catch (error) {
      setError(String(error));
    }
    setIsLoading(false);
  };

  return (
    <div className="flex h-dvh w-full">
      {/* Left panel - login form */}
      <div className="w-full lg:w-[550px] flex flex-col p-6 lg:p-10">
        {/* Logo at top left */}
        <div className="mb-8">
          <a href="/" className="inline-block">
            <RybbitTextLogo />
          </a>
        </div>
        <div className="flex-1 flex flex-col justify-center w-full max-w-[550px] mx-auto">
          <h1 className="text-lg text-neutral-600 dark:text-neutral-300 mb-6">
            {t("Welcome back")}
          </h1>
          <div className="flex flex-col gap-4">
            <SocialButtons onError={setError} callbackURL={returnTo} />
            <form onSubmit={handleSubmit}>
              <div className="flex flex-col gap-4">
                <AuthInput
                  id="email"
                  label={t("Email")}
                  type="email"
                  autoComplete="email"
                  placeholder="example@email.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                <AuthInput
                  id="password"
                  label={t("Password")}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  rightElement={
                    IS_CLOUD && (
                      <Link
                        href="/reset-password"
                        className="text-xs text-muted-foreground hover:text-primary"
                      >
                        {t("Forgot password?")}
                      </Link>
                    )
                  }
                />

                <AuthButton
                  isLoading={isLoading}
                  loadingText={t("Logging in...")}
                  disabled={isLoading}
                >
                  {t("Login")}
                </AuthButton>

                <AuthError error={error} title={t("Error Logging In")} />
              </div>
            </form>

            {!configs?.disableSignup && !isLoadingConfigs && (
              <div className="text-center text-sm">
                {t("Don't have an account?")}{" "}
                <Link
                  href="/signup"
                  className="underline underline-offset-4 hover:text-emerald-400 transition-colors duration-300"
                >
                  {t("Sign up")}
                </Link>
              </div>
            )}
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

      {/* Right panel - globe (hidden on mobile/tablet) */}
      <div className="hidden lg:block lg:w-[calc(100%-550px)] relative m-3 rounded-2xl overflow-hidden">
        <SpinningGlobe />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
