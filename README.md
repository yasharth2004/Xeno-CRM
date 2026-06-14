# Campaign Copilot

AI-native mini CRM for the Xeno engineering take-home. It is an opinionated marketer workspace: describe a campaign goal in natural language, generate the audience, draft copy, launch through a separate stub channel service, and watch delivery/read/click/conversion callbacks update the campaign analytics.

## 🚀 Live Demo

**Hosted at:** https://xeno-crm-production-d8b3.up.railway.app

Open the link and start building campaigns! The app loads with:
- 48 pre-seeded shoppers with realistic purchase history
- Suggested audience segments ready to launch
- Real-time callback simulation as campaigns send

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

The dev script starts:

- CRM app/API on `http://localhost:3000`
- Stub channel service on `http://localhost:4000`

## What It Demonstrates

- Customer and order ingestion via deterministic seed data in `data/db.json`
- Natural-language segment builder using a rule parser that can be swapped for an LLM
- AI-style audience recommendations and message generation
- Campaign launch with personalized communications
- Separate channel service with asynchronous webhook callbacks
- Event history for communication lifecycle states
- Campaign analytics with funnel metrics and an AI-style recommendation

## Architecture

```text
Browser UI
   |
   v
CRM API + static app :3000
   |
   +--> JSON CRM store
   |
   +--> Channel Service :4000
              |
              v
      CRM webhook callback
```

The CRM records events instead of trusting a single mutable status. Duplicate channel callbacks are ignored by source request id and event type, while out-of-band failures are preserved as events.

## Useful Commands

```bash
npm run seed
npm run crm
npm run channel
```

## Video Walkthrough Shape

1. Product intro: Campaign Copilot helps a marketer decide who to reach, what to say, and which channel to use.
2. Functional demo: generate a segment, draft the message, launch, and show callbacks changing analytics.
3. Architecture: explain the two services, JSON store, webhook loop, and event model.
4. Code walkthrough: show `services/crm-server.js`, `services/channel-service.js`, and `public/app.js`.
5. AI-native workflow: explain where AI assists product design, segmentation, copy generation, and code review; call out where a real LLM would replace the local heuristics.

## Deployment Notes

For a hosted submission, deploy the CRM service and channel service separately. Set:

- `CHANNEL_URL` on the CRM service to the hosted channel `/send` URL
- `CRM_WEBHOOK_URL` on the channel service to the hosted CRM `/api/webhooks/channel` URL

The current JSON file store is intentionally simple for the take-home demo. A production path would move to Postgres, queue channel sends, add idempotency keys, and aggregate analytics through a worker.
