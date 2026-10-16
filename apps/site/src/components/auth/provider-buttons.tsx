"use client";

import { useState } from "react";
import { auth } from "@content/auth";
import { AUTH_PROVIDERS, type AuthProvider } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";
import { SecondaryButton } from "./parts";

/** One button per configured provider. Success lands on the app; errors come back to this site's sign-in page. */
export function ProviderButtons({ callbackURL }: { callbackURL: string }) {
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  if (!AUTH_PROVIDERS.length) return null;
  return (
    <div className="flex flex-col gap-3" data-va-up>
      {AUTH_PROVIDERS.map((provider) => (
        <SecondaryButton
          key={provider}
          disabled={busy !== null}
          onClick={async () => {
            setBusy(provider);
            try {
              await authClient.signIn.social({
                provider,
                callbackURL,
                errorCallbackURL: `${window.location.origin}/sign-in?error=oauth`,
              });
            } finally {
              setBusy(null);
            }
          }}
        >
          <span className="va-prov">
            <ProviderLogo provider={provider} />
            {auth.providers[provider]}
          </span>
        </SecondaryButton>
      ))}
    </div>
  );
}

/**
 * The providers' own marks, unaltered, 18px, left of the label. Official path data: GitHub's Invertocat
 * (brand.github.com, GitHub_Logos.zip: GitHub_Invertocat_White.svg), Google's "G" (developers.google.com/identity/branding-guidelines, signin-assets.zip), Microsoft's four squares
 * (Microsoft identity platform sign-in branding).
 */
export function ProviderLogo({ provider }: { provider: AuthProvider }) {
  if (provider === "github")
    return (
      <svg className="va-plogo" viewBox="0 0 98 96" aria-hidden="true" focusable="false">
        {/* GitHub's guidelines: the mark in one colour, unaltered. Paper on ink. */}
        <path
          fill="currentColor"
          d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"
        />
      </svg>
    );
  if (provider === "google")
    return (
      // The one exception to design.md's palette: Google's sign-in branding guidelines require the standard-colour
      // (gradient) "G", never monochrome or an outdated G. Path data from Google's signin-assets.zip (Dark, icon only),
      // the button's own background removed, ids made unique.
      <svg className="va-plogo" viewBox="10 10 20 20" fill="none" aria-hidden="true" focusable="false">
        <mask id="va-gg-m" style={{ maskType: "alpha" }} maskUnits="userSpaceOnUse" x="10" y="10" width="20" height="20">
          <path
            d="M29.3987 18.1814H19.9849V22.0445H25.3598C25.1286 23.294 24.4294 24.3596 23.3676 25.0712C22.4746 25.6716 21.3266 26.0211 19.9849 26.0211C17.3864 26.0211 15.1823 24.2666 14.3947 21.9004C14.1952 21.2989 14.0853 20.6599 14.0853 19.9983C14.0853 19.3367 14.1952 18.6966 14.3947 18.0962C15.1823 15.7311 17.3864 13.9755 19.9849 13.9755C21.4524 13.9755 22.767 14.4816 23.8039 15.4713L26.6653 12.6057C24.936 10.9908 22.6786 10 19.9849 10C16.0832 10 12.705 12.2414 11.0618 15.5076C10.383 16.8592 10 18.3834 10 19.9994C10 21.6155 10.383 23.1396 11.0618 24.4913C12.705 27.7597 16.0832 30 19.9849 30C22.6797 30 24.9485 29.1137 26.6018 27.5861C28.4887 25.8452 29.5732 23.2702 29.5732 20.2275C29.5732 19.5182 29.5131 18.835 29.3987 18.1825V18.1814Z"
            fill="#E94FFF"
          />
        </mask>
        <g mask="url(#va-gg-m)">
          <g filter="url(#va-gg-f0)">
            <g clipPath="url(#va-gg-c)">
              <g transform="matrix(0.00804129 -0.00805186 0.00804128 0.00805186 19.6819 19.7927)">
                <foreignObject x="-2105.64" y="-2105.64" width="4211.29" height="4211.29">
                  <div
                    style={{
                      background:
                        "conic-gradient(from 90deg,rgba(255, 70, 65, 1) 0deg,rgba(255, 70, 65, 1) 4.14555deg,rgba(49, 134, 255, 1) 39.154deg,rgba(49, 134, 255, 1) 72.0044deg,rgba(0, 165, 183, 1) 96.7463deg,rgba(14, 188, 95, 1) 120.897deg,rgba(14, 188, 95, 1) 154.722deg,rgba(108, 196, 0, 1) 179.136deg,rgba(255, 204, 0, 1) 203.588deg,rgba(255, 211, 20, 1) 226.915deg,rgba(255, 204, 0, 1) 251.688deg,rgba(255, 106, 43, 1) 273.129deg,rgba(253, 70, 65, 1) 289.305deg,rgba(255, 70, 65, 1) 359.593deg,rgba(255, 70, 65, 1) 360deg)",
                      height: "100%",
                      width: "100%",
                    }}
                  />
                </foreignObject>
              </g>
            </g>
          </g>
          <g filter="url(#va-gg-f1)">
            <ellipse cx="20.0496" cy="20.2413" rx="5.39634" ry="2.83537" transform="rotate(24.4473 20.0496 20.2413)" fill="#3186FF" />
          </g>
          <g filter="url(#va-gg-f2)">
            <ellipse cx="33.3538" cy="18.2155" rx="7.43918" ry="3.09357" fill="#3186FF" />
          </g>
          <g filter="url(#va-gg-f3)">
            <ellipse cx="25.2744" cy="16.2195" rx="7.40854" ry="2.37805" fill="#FF4641" />
          </g>
          <g filter="url(#va-gg-f4)">
            <ellipse cx="29.5427" cy="12.9268" rx="7.40854" ry="2.37805" fill="#FF5B8B" />
          </g>
          <g filter="url(#va-gg-f5)">
            <ellipse cx="24.4817" cy="19.878" rx="8.5061" ry="3.10976" fill="#3186FF" />
          </g>
          <g filter="url(#va-gg-f6)">
            <ellipse cx="25.1842" cy="14.0197" rx="4.53882" ry="2.37805" transform="rotate(-28.6599 25.1842 14.0197)" fill="#FF4641" />
          </g>
        </g>
        <defs>
          <filter id="va-gg-f0" x="5.25922" y="4.90668" width="29.7381" height="29.772" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur" />
          </filter>
          <clipPath id="va-gg-c">
            <path d="M7.25922 19.7927C7.25922 12.6759 13.0209 6.90668 20.1283 6.90668C27.2357 6.90668 32.9973 12.6759 32.9973 19.7927C32.9973 26.9094 27.2357 32.6786 20.1283 32.6786C13.0209 32.6786 7.25921 26.9094 7.25922 19.7927Z" />
          </clipPath>
          <filter id="va-gg-f1" x="12.9977" y="14.828" width="14.1038" height="10.8265" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur" />
          </filter>
          <filter id="va-gg-f2" x="23.9146" y="13.1219" width="18.8784" height="10.1871" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur" />
          </filter>
          <filter id="va-gg-f3" x="15.8659" y="11.8415" width="18.8171" height="8.7561" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur" />
          </filter>
          <filter id="va-gg-f4" x="20.1341" y="8.54878" width="18.8171" height="8.7561" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur" />
          </filter>
          <filter id="va-gg-f5" x="13.9756" y="14.7683" width="21.0122" height="10.2195" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur" />
          </filter>
          <filter id="va-gg-f6" x="19.0404" y="9.00419" width="12.2878" height="10.0309" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur" />
          </filter>
        </defs>
      </svg>
    );
  return (
    // Microsoft's four-colour logo, required on its sign-in buttons (the same documented palette exception as Google's).
    <svg className="va-plogo" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <path fill="#F25022" d="M1 1h9v9H1z" />
      <path fill="#00A4EF" d="M1 11h9v9H1z" />
      <path fill="#7FBA00" d="M11 1h9v9h-9z" />
      <path fill="#FFB900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

export function OrDivider() {
  return (
    <p className="flex items-center gap-4 text-[15px] leading-none text-mute" aria-hidden data-va-up>
      <span className="h-px flex-1 bg-line" />
      {auth.or}
      <span className="h-px flex-1 bg-line" />
    </p>
  );
}
