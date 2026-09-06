# Three-minute demo script

Two phones you control: **A** answers as the driver, **B** answers as the receiving dock. Pre-fill both numbers through `DEMO_DRIVER_PHONE` and `DEMO_DOCK_PHONE` so nothing is typed on camera. Record the screen and the phones in the same take; the CALL-E dashboard Call Records are the independent proof.

Before recording: `/api/health` shows `accepted`, the previous demo incident is closed, and `DS-1042` is free (the form suggests the next id automatically).

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:20 | Home page, the "manual chase today" panel | "A reefer load missed its 14:00 dock window. The tracking portal has nothing since 09:52. Today an ops desk phones the driver, then the dock, then the dispatcher, and retypes what it heard. Nobody can prove later who said what." |
| 0:20–0:40 | Green **CALL-E ready** banner; intake form already filled; click **Create incident** | "DockSignal is a real CALL-E integration: no mock mode. If the server key is missing or rejected, this button is dead and no result can ever appear." |
| 0:40–1:05 | Call plan: two recipients, goals, questions, boundaries; expand *Inspect* on the driver card to show task text, result schema, idempotency key | "Before anything rings, the operator sees exactly who is called, what the assistant may ask, and what it must not do: identify as an AI, no booking, no fees. The idempotency key means a refresh or restart cannot double-call." |
| 1:05–1:20 | Tick the authorization box, **Launch fact-finding calls**, confirm dialog with both E.164 numbers | "Only numbers we are authorized to call. Two real calls, concurrently." Phones A and B ring. |
| 1:20–1:50 | Incident room: two cards with `call_…` ids, *in progress*. Answer A: "I'm at Tuas checkpoint, customs queue, I'll be at the dock at 16:40." Answer B: "Slot is gone, we can receive until 16:00, anything later needs the receiving manager." | Keep answers short and give exact clock times. |
| 1:50–2:15 | Cards flip to *completed*; webhook table shows `evt_…` ids; open the driver transcript and the structured result (`revised_eta: 16:40`) | "Every card is CALL-E's own terminal snapshot, deduplicated by event id and re-fetched from the API before we trust it. Summary, confidence, evidence, and transcript are all provider data." |
| 2:15–2:40 | Recovery card: **Revised ETA is after the receiving cutoff**, gap 40 min, facts with sources, confidence reasons, suggested action *Ask the dock to accept arrival at 16:40* | "The rules engine only combines supported facts. Unknowns stay unknown; if the driver and dispatcher disagreed this field would say *conflicted*. It proposes the exception call but will not place it." |
| 2:40–2:55 | Click **Approve follow-up call**, tick the approval, confirm. Phone B rings; answer "Yes, 16:45 at door 3 is fine." Card shows *Dock accepted the revised arrival* | "A human approves anything that changes the appointment. The approver and time are in the audit log." |
| 2:55–3:00 | Decision log, **Download Markdown summary**, close incident | "One incident, three real calls, every fact traceable to a call id." |

Fallback branches, all real: if phone A gives a vague time ("later this afternoon") the card shows *Revised ETA not established* and never invents a time; if phone B does not answer, the dock card shows *failed* and the receiving window stays unresolved.

Do not spend video time on login (there is none), settings, or CRUD.
