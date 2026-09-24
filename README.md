# Caching and Queues

Standalone learning repo. Work here on its own — no other repos required.

**Phase (for your own roadmap):** Backend

## Context

Caches cut latency; queues absorb load and decouple work. Redis patterns, Kafka/RabbitMQ, pub/sub, and background jobs are the bread and butter of scalable backends — practiced here alone.

This repository is the single place for everything related to **Caching and Queues**: notes, exercises, and small projects. Clone it, open it, and treat it as a complete unit of study.

## Scope

- Redis caching patterns (aside, write-through, TTLs, stampedes)
- Message queues: Kafka and RabbitMQ roles
- Pub/sub vs work queues
- Background jobs and retries / dead-letter ideas
- Cache invalidation and consistency tradeoffs

## Outcomes

When you are done with this repo, you should be able to:

- Pick cache vs queue for a given problem
- Implement a small cached read path and a background job
- Explain failure modes (stampede, poison messages, at-least-once)

## How to work in this repo

1. Read / write concept notes under `notes/`.
2. Solve practice problems under `exercises/`.
3. Ship at least one small project under `projects/` that forces the ideas to stick.
4. Tick the checklist below as you go.

You do not need any other curriculum repo open while you work here.

## Layout

```
caching-and-queues/
├── README.md       # Context and checklist (this file)
├── notes/          # Concept write-ups
├── exercises/      # Practice problems and solutions
└── projects/       # Mini builds that apply the topic
```

## Progress

- [ ] Core concepts noted
- [ ] Exercises completed
- [ ] Mini-project shipped
- [ ] Can explain the main ideas without looking anything up

## Resources

Add books, docs, courses, and articles here as you find them. Keep this list local to this topic.

---

_This repo is independent. Progress elsewhere does not block work here._
