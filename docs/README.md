# Chapman documentation

| Guide                                                        | Use it for                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [Feature checklist](feature-checklist.md)                    | Agreed decisions, current implementation, and milestone order              |
| [Installation](../INSTALL.md)                                | Native and Docker installation, production, upgrades                       |
| [Agent-assisted installation](agentic-install.md)            | A safe prompt testers can paste into a coding agent                        |
| [Storefront and integration configuration](configuration.md) | Onboarding, provider keys, dedicated setup pages, test chat, call, and SMS |
| [Catalogue format](catalog-format.md)                        | The JSON product-feed contract                                             |
| [Fresh storefront setup](fresh-store-setup.md)               | Configure and verify every feature from an empty Docker volume             |
| [Architecture](architecture.md)                              | Trust boundaries and subsystem design                                      |
| [SQLite operations](database.md)                             | Persistence, migrations, health, backup, and restore                        |
| [Demo runbook](demo-plan.md)                                 | A clean, unconfigured-to-working Monsoon Market demonstration              |
| [Synthetic demo data](demo-data.md)                          | Repeatable Monsoon and Fieldnote histories for Analyst, Memory, and Recovery |
| [Troubleshooting](troubleshooting.md)                        | Symptom-first fixes                                                        |

Start with [Installation](../INSTALL.md). A fresh Chapman instance is supposed
to know nothing about a storefront until a signed-in merchant registers it.
The current build is a combined self-hosted dashboard and gateway. Future plans
for independently hosted dashboard/gateway services and Firecrawl-backed
catalogue acquisition are documented in the
[feature checklist](feature-checklist.md) and
[architecture](architecture.md#14-future-deployment-split).
