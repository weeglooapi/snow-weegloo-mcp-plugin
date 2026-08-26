---
name: weegloo-service-login-connect
description: Provider-specific setup for Weegloo ServiceLogin with **connect** — the internal NEOID single sign-on, available on the internal stack only. **People call this login by several names — connect, NSS, 커넥트, 커넥트:NSS, NEOID, 네오아이디, 사내 SSO, 사내 로그인 — and they all mean THIS provider, whose Weegloo `registrationId` is always `connect`** (never `nss` / `neoid`); use this skill whenever a request names any of them. **connect needs NO console setup and NO questions to the user:** shared NEOID credentials are already registered platform-side, so read the three values (서비스 ID → `clientId`, Master Key → `clientSecret`, 컨슈머 키 → `clientName`) from the Weegloo docs and fill them in yourself — never send the user to the NEOID dashboard and never ask them for credentials. Also covers `clientName`, which is required for connect and exists for no other provider, and the fact that the browser entry URL stays on the normal `auth.sn-weegloo.com` host. Use ONLY when the chosen provider is connect. For the provider-agnostic wire protocol / SDK / callback flow see `weegloo-service-login-sdk`; for the conceptual model see `weegloo-service-login`. Do not use this for another provider (Google, GitHub, Facebook, GitLab, LINE, Kakao, or Naver).
---

# Weegloo ServiceLogin — connect (NEOID) provider setup

This is the **connect instance** of the provider-agnostic ServiceLogin setup. `connect` is the
**internal NEOID single sign-on**. Everything else (the wire protocol, the SDK, `callbackUrl`,
`exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-sdk`** (the spine). This skill does **not** decide whether to use connect —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-connect provider** (other providers follow a similar *shape*, but their console steps differ —
> Google, GitHub, Kakao, Naver, and LINE have their own dedicated skills; Facebook and GitLab ride the
> spine's generic shape — see *Configuration responsibilities* in the spine).

**`connect` is internal-only.** It exists on the internal stack and nowhere else, so never offer it for
a product that must serve users outside the company — those need a public provider.

## The headline: connect is the ZERO-SETUP provider

Every other provider blocks on credentials only the user can produce, so its skill ends by *asking*.
**connect does not.** A shared NEOID service is already registered platform-side, so:

- **Ask the user for nothing.** No 서비스 ID, no Master Key, no 컨슈머 키. Those are shared values you
  look up yourself (next section).
- **Send the user to no console.** There is no NEOID dashboard visit, no service to create, no
  **IDP 등록**, no form to fill, and **no callback URL to register** — the shared service already has it.
- **Never report connect as "blocked pending credentials."** For connect that state does not exist. If
  you find yourself about to ask the user for a credential, you have mis-read this skill.

The only inputs left are the ones every provider needs (`callbackUrl`, `defaultRole`, and the rest of
the `ServiceLogin` payload) — resolve those per the spine, not by asking.

## The three shared values — look them up, do not ask

They live in the Weegloo docs, in the **Shared values you can use without registering at NEOID**
section. Fetch the Markdown page and read the table:

```
https://docs.sn-weegloo.com/getting-started/core-concepts/service-users/service-login.md
```

(Human-readable form of the same section:
`https://docs.sn-weegloo.com/en-US/getting-started/core-concepts/service-users/service-login/#connect-shared-credentials`)

| Docs box | → `providers[]` field |
|---|---|
| **서비스 ID** | `clientId` |
| **Master Key** | `clientSecret` |
| **컨슈머 키** | `clientName` |

- **Read them at the time you need them** rather than carrying a copy around — the docs page is the
  source of truth, and these values are not reproduced in this skill on purpose.
- **All three are required.** Leaving `clientName` (컨슈머 키) out silently breaks sign-in — see below.
- The docs page reaches the docs index the normal way (`llms.txt` → this exact path + `.md`); if the
  fetch fails, re-derive the path from the index rather than hand-building a nearby one.

## The `ServiceLogin` payload for connect

`cma_CreateServiceLogin` takes the provider config inside the **`providers[]`** array, and the key that
names the provider is **`registrationId`**:

```jsonc
"providers": [
  {
    "registrationId": "connect",   // always this literal — never "nss" / "neoid" / "커넥트"
    "clientId":     "<서비스 ID from the docs table>",
    "clientSecret": "<Master Key from the docs table>",
    "clientName":   "<컨슈머 키 from the docs table>"   // connect only
  }
]
```

Plus `defaultRole`, `callbackUrl`, and the rest of the required payload per the spine.

## `clientName` — the connect-only third credential

`ServiceLogin` providers normally take `clientId` + `clientSecret`. **connect additionally requires
`clientName`**, whose value is NEOID's **컨슈머 키**.

- **Required for connect.** Omitting it leaves sign-in broken — and it fails *quietly*, so it is easy to
  miss. No other provider has this field, which is exactly why it gets skipped.
- **It is not a secret** (unlike `clientSecret`), so it needs no secret-handling ceremony.
- **Do not set `clientName` for any other provider** — it exists only for connect.

## One login, several names — `NSS`, `NEOID`, 커넥트

People rarely call it "connect". Expect any of these to mean **this** provider:

| What the user says | What it is |
|---|---|
| **NSS**, **커넥트:NSS** | how the IDP is labelled inside the NEOID console — the name most people repeat |
| **NEOID**, 네오아이디 | the internal identity system behind it |
| 커넥트, connect | the Weegloo provider key |
| 사내 SSO, 사내 로그인, 사내 계정 로그인 | what it is functionally |

- **Treat all of them as this skill's subject.** A request like "NSS 로그인 붙여줘" is a connect request —
  don't go looking for a separate NSS provider skill, and don't fall back to the spine's generic shape as
  if no dedicated skill existed.
- **But the `registrationId` VALUE is always `connect`.** These are names people use, never values. Never
  send `nss` / `neoid` / `커넥트` as `registrationId` or in the URL path — a wrong provider value is not a
  spelling problem, sign-in simply never works.
- Say **connect** back once when you answer (e.g. "connect(NSS) 로그인으로 구성합니다"), so the user's
  wording and the actual configuration value are visibly the same thing.

## The browser entry URL is normal — no SDK override

connect's NEOID-side callback is served on a different host than other providers, but **that is already
registered on the shared service and is not yours to configure.** What matters for your code:

- **The browser entry URL stays on the normal host** —
  `https://auth.sn-weegloo.com/v1/spaces/{spaceId}/login/oauth2/connect` — so the SDK needs **no**
  `authBaseUrl` override. Wire it exactly as the spine describes.
- **`callbackUrl` on your `ServiceLogin`** (the URL on *your product* that receives `?exchangeToken=…`)
  behaves like every other provider: deploy-dependent, set per the spine (pitfall **G**).

## Escape hatch — a product that needs its own NEOID service

Rare. Only when the product genuinely cannot share the platform service (e.g. it needs its own NEOID
service identity). In that case the user registers at NEOID themselves and supplies their own three
values; the full console procedure lives in the docs page linked above, under the **Connect** section.
**Do not take this path by default, and do not walk the user through it unprompted** — the shared values
are the normal answer.

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-sdk`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE).
