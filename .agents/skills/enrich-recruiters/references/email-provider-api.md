# Email-provider request reference

These are credential-free request and success-response shapes tested on 2026-08-27. Set API keys in environment variables or a user-managed secret store; do not paste them into files, output, or chat.

| Provider | Environment variable | Request header |
| --- | --- | --- |
| AnyMail Finder | `ANYMAIL_FINDER_API_KEY` | `Authorization` |
| Prospeo | `PROSPEO_API_KEY` | `X-Key` |
| LeadMagic | `LEADMAGIC_API_KEY` | `X-Api-Key` |

## AnyMail Finder

```http
POST https://api.anymailfinder.com/v5.1/find-email/linkedin-url
Authorization: $ANYMAIL_FINDER_API_KEY
Content-Type: application/json

{"linkedin_url":"<linkedin-profile-url>"}
```

```json
{
  "email": "person@company.com",
  "email_status": "valid",
  "valid_email": "person@company.com",
  "person_full_name": "Person Name",
  "person_company_name": "Company Name"
}
```

Accept only when `email_status` is `valid` and `valid_email` is present.

## Prospeo

```http
POST https://api.prospeo.io/enrich-person
X-Key: $PROSPEO_API_KEY
Content-Type: application/json

{
  "only_verified_email": true,
  "data": {
    "full_name": "Person Name",
    "company_website": "company.com"
  }
}
```

```json
{
  "error": false,
  "person": {
    "full_name": "Person Name",
    "linkedin_url": "https://www.linkedin.com/in/example",
    "email": {
      "status": "VERIFIED",
      "revealed": true,
      "email": "person@company.com",
      "verification_method": "SMTP"
    }
  }
}
```

Accept only when `error` is `false`, `person.email.status` is `VERIFIED`, `person.email.revealed` is `true`, and `person.email.email` is present.

## LeadMagic

```http
POST https://api.leadmagic.io/v1/people/email-finder
X-Api-Key: $LEADMAGIC_API_KEY
Content-Type: application/json

{
  "first_name": "Person",
  "last_name": "Name",
  "company_name": "Company Name"
}
```

```json
{
  "email": "person@company.com",
  "status": "valid",
  "message": "Email was confidently found and verified.",
  "company_name": "Company Name"
}
```

Accept only when `status` is `valid` and `email` is present.
