"use client";

import { Button } from "@/components/ui/button";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { authClient } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "@/api/utils";
import { useExtracted } from "next-intl";
import Image from "next/image";

interface SocialButtonsProps {
  onError: (error: string) => void;
  callbackURL?: string;
  mode?: "signin" | "signup";
  className?: string;
}

export function SocialButtons({ onError, callbackURL, mode = "signin", className = "" }: SocialButtonsProps) {
  const t = useExtracted();

  const { data: configs } = useQuery({ queryKey: ["configs"], queryFn: () => authedFetch<{ socialProviders?: string[] }>("/config") });
  const providers = configs?.socialProviders || [];
  if (!providers.length) return null;

  const handleSocialAuth = async (provider: "google" | "github" | "twitter") => {
    try {
      await authClient.signIn.social({
        provider,
        ...(callbackURL ? { callbackURL } : {}),
        // For signup flow, new users should also be redirected to the callbackURL
        ...(mode === "signup" && callbackURL ? { newUserCallbackURL: callbackURL } : {}),
      });
    } catch (error) {
      onError(String(error));
    }
  };

  return (
    <>
      <div className={`flex flex-col gap-2 ${className}`}>
        {providers.includes("google") && <Button type="button" onClick={() => handleSocialAuth("google")} className="h-11">
          <Image src="/crawlers/Google.svg" alt="Google" width={16} height={16} />
          {t("Continue with Google")}
        </Button>}
        {providers.includes("github") && <Button type="button" onClick={() => handleSocialAuth("github")} className="h-11">
          <SiGithub />
          {t("Continue with GitHub")}
        </Button>}
      </div>
      <div className="relative flex items-center text-xs uppercase">
        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
        <span className="px-3 text-muted-foreground">{t("Or continue with email")}</span>
        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
      </div>
    </>
  );
}
