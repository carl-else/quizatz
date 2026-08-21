# Quizatz

Quizatz is a temporary, collaborative live-questioning application for internal company use. It models a shared event in which an organizer presents questions and participants respond together.

## Language

**Live session**:
A temporary shared event containing questions, participants, and live results. A live session may be scored or unscored; it is not a separate quiz or poll type.
_Avoid_: Quiz, poll, room

**Lobby**:
The pre-start state of a live session, in which participants may join and wait while the organizer sees their count.
_Avoid_: Waiting room

**QR join display**:
A public, projection-oriented page opened by an organizer from the lobby. It presents a QR code and text link for joining a live session, and may show only its privacy-safe lifecycle availability.
_Avoid_: QR invitation, barcode page

**Active question**:
The single question currently presented in a started live session. Late-joining participants may respond only to the active question.
_Avoid_: Current slide

**Question state**:
A question's position in a linear live session: upcoming, active, closed, or revealed. Closed questions cannot be reopened in the MVP.
_Avoid_: Revisited question

**Organizer**:
The person signed in with a work or school Microsoft account who creates and controls a live session. Organizer control is not transferable in the MVP.
_Avoid_: Creator, host

**Participant**:
A person who joins a live session to submit responses. A named participant signs in with a Microsoft account; an anonymous participant joins without signing in when the organizer permits it.
_Avoid_: Player, attendee

**Anonymous participation**:
Participation that does not identify the participant and permits anyone with the live session ID to join.
_Avoid_: Guest access, domain-restricted participation

**Single-choice question**:
A question for which a participant selects one answer from a defined set of options. A true-or-false question is a single-choice question with two options.
_Avoid_: Multiple-choice question, true-or-false question

**Open-ended question**:
A question for which a participant submits free-form text. Its result can be consolidated by an organizer into equivalent answers.
_Avoid_: Free-text question

**Open-ended result**:
A frequency-ranked list of the submitted texts for a closed open-ended question. The organizer may consolidate equivalent entries before revealing it.
_Avoid_: Tag cloud

**Session access policy**:
The organizer-defined rules for joining a live session: named or anonymous participation and an optional password.
_Avoid_: Room security, entry rules

**Session limit**:
The MVP's maximum authored content for a live session: 50 questions, each with up to 8 options when it is a single-choice question.
_Avoid_: Unlimited session

**Session lease**:
The non-extendable 24-hour lifetime of a live session, measured from its creation.
_Avoid_: Inactivity timeout, renewable session

**Expired session**:
A live session whose lease has elapsed. Quizatz immediately ends it, shows every participant an expired-session state without session content, and performs best-effort physical cleanup of its state.
_Avoid_: Inactive session, ended session

**Cleanup window**:
The 24-hour period after logical expiry during which Quizatz retries physical removal of an expired session's state. The session remains inaccessible throughout the window; unresolved cleanup emits a non-sensitive operational alert for manual follow-up.
_Avoid_: Session history, retention period

**Shared timer**:
An optional deadline that applies to the same question for every participant at the same time. Its expiry automatically closes the active question.
_Avoid_: Per-user timer, individual timer

**Answer revision**:
Replacing a participant's submitted response while its question remains open. Only the participant's latest response is counted.
_Avoid_: Multiple votes, answer history

**Result reveal**:
The organizer-controlled act of making a closed question's aggregate results visible to participants.
_Avoid_: Live results

**Single-choice result**:
Aggregate response counts, percentages, and total response count for a closed single-choice question, presented as a bar chart.
_Avoid_: Leaderboard

**Final summary**:
The participant-visible view of all revealed aggregate results after the organizer ends a live session. Existing participants may view it until leaving or refreshing; new and reconnecting participants see the closed-session state.
_Avoid_: Session history
