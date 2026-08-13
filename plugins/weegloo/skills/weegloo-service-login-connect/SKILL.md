---
name: weegloo-service-login-connect
description: Provider-specific setup for Weegloo ServiceLogin with **connect** — the internal NEOID single sign-on, available on the internal stack only. **People call this login by several names — connect, NSS, 커넥트, 커넥트:NSS, NEOID, 네오아이디, 사내 SSO, 사내 로그인 — and they all mean THIS provider, whose Weegloo `provider` key is always `connect`** (never `nss` / `neoid`); use this skill whenever a request names any of them. Covers the NEOID dashboard steps (create a service, then 서비스 설정 → 컨슈머 관리 → IDP 등록 → 커넥트:NSS), the literal `NEOID` values that go into the IDP form (NOT the credentials Weegloo needs), the three values Weegloo does need — 서비스 ID → `clientId`, Master Key → `clientSecret`, 컨슈머 키 → `clientName` — and the callback-host exception that makes connect unlike every other provider: the URL registered at NEOID must be on `https://auth-sn-weegloo.navercorp.com`, NOT `auth.sn-weegloo.com`. `clientName` is required for connect and exists for no other provider. Use ONLY when the chosen provider is connect. For the provider-agnostic wire protocol / SDK / callback flow see `weegloo-service-login-sdk`; for the conceptual model see `weegloo-service-login`. Do not use this for another provider (Google, GitHub, Facebook, GitLab, LINE, Kakao, or Naver).
---

# Weegloo ServiceLogin — connect (NEOID) provider setup

This is the **connect instance** of the provider-agnostic ServiceLogin setup. `connect` is the
**internal NEOID single sign-on**, so this skill covers only the **NEOID dashboard** side: creating the
service and producing the three values `ServiceLogin` needs. Everything else (the wire protocol, the
SDK, `callbackUrl`, `exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-sdk`** (the spine). This skill does **not** decide whether to use connect —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-connect provider** (other providers follow a similar *shape*, but their console steps differ —
> Google, GitHub, Kakao, Naver, and LINE have their own dedicated skills; Facebook and GitLab ride the
> spine's generic shape — see *Configuration responsibilities* in the spine).

**`connect` is internal-only.** It exists on the internal stack and nowhere else, so never offer it for
a product that must serve users outside the company — those need a public provider.

## One login, several names — `NSS`, `NEOID`, 커넥트

People rarely call it "connect". Expect any of these to mean **this** provider:

| What the user says | What it is |
|---|---|
| **NSS**, **커넥트:NSS** | how the IDP is labelled inside the NEOID console — the name most people repeat |
| **NEOID**, 네오아이디 | the admin dashboard where the service is created |
| 커넥트, connect | the Weegloo provider key |
| 사내 SSO, 사내 로그인, 사내 계정 로그인 | what it is functionally |

- **Treat all of them as this skill's subject.** A request like "NSS 로그인 붙여줘" is a connect request —
  don't go looking for a separate NSS provider skill, and don't fall back to the spine's generic shape as
  if no dedicated skill existed.
- **But the `provider` VALUE is always `connect`.** These are names people use, never values. Never send
  `nss` / `neoid` / `커넥트` as the `provider` field or in the URL path — a wrong provider value is not a
  spelling problem, sign-in simply never works.
- Say **connect** back once when you answer (e.g. "connect(NSS) 로그인으로 구성합니다"), so the user's
  wording and the actual configuration value are visibly the same thing.

## Two ways connect departs from every other provider

Both are easy to get wrong because the rest of the corpus states the opposite as the general rule.

1. **The callback URL is registered on a DIFFERENT host** — `auth-sn-weegloo.navercorp.com`, not
   `auth.sn-weegloo.com`. Everywhere else the two URLs share one host; for connect they do not.
2. **A third credential, `clientName`,** is required. No other provider has it.

## The callback URL to register at NEOID (deploy-independent — register it now)

With the real `{spaceId}` substituted:

```
https://auth-sn-weegloo.navercorp.com/v1/spaces/{spaceId}/login/oauth2/code/connect
```

- **The host MUST be `auth-sn-weegloo.navercorp.com`.** Registering the `auth.sn-weegloo.com` form —
  the host every other provider skill tells you to use — does **not** work for connect. The two names
  are not aliases of one another; they are served by different infrastructure.
- The `/code/` segment is required — this is the **NEOID → Weegloo** callback, **not** the browser entry
  URL (spine pitfall **A**).
- **The browser entry URL is unaffected:** it stays on the normal host,
  `https://auth.sn-weegloo.com/v1/spaces/{spaceId}/login/oauth2/connect`, so the SDK needs **no**
  `authBaseUrl` override. Only the value typed into NEOID's form uses the `navercorp.com` host.
- It depends only on that host + your `spaceId` + `connect`, so it is **fully known now** — register it
  before the app is deployed (spine pitfall **G**). `callbackUrl` on your `ServiceLogin` is the
  deploy-dependent one; this is not.

## `clientName` — the connect-only third credential

`ServiceLogin` normally takes `clientId` + `clientSecret`. **connect additionally requires
`clientName`**, whose value is NEOID's **컨슈머 키**.

- **Required for connect.** Omitting it leaves sign-in unconfigured — treat it as blocking, exactly like
  `clientId` / `clientSecret`.
- **It is not a secret** (unlike `clientSecret`), so it needs no secret-handling ceremony.
- **It cannot be rotated.** Neither can the Master Key. So there is no "regenerate the credential" fix —
  plan accordingly rather than assuming a rotation path exists.
- **Do not set `clientName` for any other provider** — it exists only for connect.

## Walk the user through it — the three values are blocking inputs

They come from the user's **own NEOID service** and only the user can produce them. So when you reach
this step, **stop and ask** — and **don't ask bare**. Hand the user this walkthrough, with the real
`{spaceId}` already filled into the callback URL above:

1. Go to the **NEOID admin dashboard**: **https://neoid.admin.navercorp.com/dashboard** and **create a
   service**.
2. In that service, go to **서비스 설정 → 컨슈머 관리 → IDP 등록** and register **커넥트:NSS**.
3. Fill the IDP form with these values — **note that its "client id" / "client secret" fields are NOT
   Weegloo's `clientId` / `clientSecret`.** They take the literal string `NEOID`. Mixing these up is the
   single most likely mistake here:

   | IDP 등록 field | Value to enter |
   |---|---|
   | client id | `NEOID` (the literal word) |
   | client secret | `NEOID` (the literal word) |
   | callback url | the `auth-sn-weegloo.navercorp.com` URL above, with the real `{spaceId}` |
   | scope | **leave empty** |

   **Leaving `scope` empty is correct** — every field Weegloo needs for the `ServiceUser` still comes
   back. Do not invent scope values to "be safe."
4. Then read the created service's own values and send those back — these are the ones Weegloo needs:

   | NEOID service value | → `ServiceLogin` field |
   |---|---|
   | **서비스 ID** | `clientId` |
   | **Master Key** | `clientSecret` |
   | **컨슈머 키** | `clientName` |

There is **no approval or review step** — the service is usable as soon as it is created, and there is
no test-user allowlist to maintain (contrast Google's consent screen and Naver's development status).

Then create the `ServiceLogin` with those three values (provider `connect`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the values*, not by reporting connect sign-in as done.

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-sdk`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE).
