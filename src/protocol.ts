export const SESSION_CODE_LENGTH = 6;
export const SESSION_LEASE_MS = 24 * 60 * 60 * 1000;

export type SessionAccessPolicy = "anonymous" | "named";

export interface SingleChoiceOption {
  id: string;
  text: string;
}

export interface SingleChoiceQuestion {
  kind: "single-choice";
  id: string;
  text: string;
  options: SingleChoiceOption[];
}

export interface OpenEndedQuestion {
  kind: "open-ended";
  id: string;
  text: string;
}

export type Question = SingleChoiceQuestion | OpenEndedQuestion;

export type QuestionState = "upcoming" | "active" | "closed" | "revealed";

export interface SessionQuestion {
  question: Question;
  state: QuestionState;
  timerSeconds?: number;
}

export interface StartSingleChoiceQuestion {
  kind: "single-choice";
  text: string;
  options: string[];
}

export interface StartOpenEndedQuestion {
  kind: "open-ended";
  text: string;
}

export type QuestionDefinition = StartSingleChoiceQuestion | StartOpenEndedQuestion;

export interface AuthorQuestionCommand {
  type: "author-question";
  question: QuestionDefinition;
  timerSeconds?: number;
}

export interface EditNextQuestionCommand {
  type: "edit-next-question";
  question: QuestionDefinition;
  timerSeconds?: number;
}

export interface StartLiveSessionCommand {
  type: "start-live-session";
}

export interface StartNextQuestionCommand {
  type: "start-next-question";
}

export interface AnswerSingleChoiceQuestionCommand {
  type: "answer-question";
  optionId: string;
}

export interface AnswerOpenEndedQuestionCommand {
  type: "answer-question";
  text: string;
}

export interface MergeOpenEndedResultCommand {
  type: "merge-open-ended-result";
  sourceText: string;
  targetText: string;
}

export interface CloseQuestionCommand {
  type: "close-question";
}

export interface RevealQuestionCommand {
  type: "reveal-question";
}

export interface SingleChoiceResult {
  options: Array<SingleChoiceOption & { responseCount: number; percentage: number }>;
  totalResponseCount: number;
}

export interface OpenEndedResultEntry {
  text: string;
  responseCount: number;
}

export interface OpenEndedResult {
  entries: OpenEndedResultEntry[];
  totalResponseCount: number;
}

export interface LobbySnapshot {
  type: "lobby";
  sessionCode: string;
  participantCount: number;
  expiresAt: string;
}

export interface ActiveQuestionSnapshot {
  type: "active-question";
  question: Question;
  timerDeadline?: string;
}

export interface OrganizerQuestionQueueSnapshot {
  type: "organizer-question-queue";
  questions: SessionQuestion[];
  activeQuestionIndex?: number;
}

export interface ClosedQuestionSnapshot {
  type: "closed-question";
  question: Question;
}

export interface ClosedOpenEndedQuestionSnapshot {
  type: "closed-open-ended-question";
  question: OpenEndedQuestion;
  result: OpenEndedResult;
}

export interface RevealedSingleChoiceQuestionSnapshot {
  type: "revealed-question";
  question: SingleChoiceQuestion;
  result: SingleChoiceResult;
}

export interface RevealedOpenEndedQuestionSnapshot {
  type: "revealed-question";
  question: OpenEndedQuestion;
  result: OpenEndedResult;
}

export type RevealedQuestionSnapshot = RevealedSingleChoiceQuestionSnapshot | RevealedOpenEndedQuestionSnapshot;

export interface AnswerAcceptedMessage {
  type: "answer-accepted";
  optionId?: string;
  text?: string;
}

export type LobbyMessage =
  | LobbySnapshot
  | ActiveQuestionSnapshot
  | OrganizerQuestionQueueSnapshot
  | ClosedQuestionSnapshot
  | ClosedOpenEndedQuestionSnapshot
  | RevealedQuestionSnapshot
  | AnswerAcceptedMessage
  | { type: "expired" }
  | { type: "join-required" };

export interface SessionCreated {
  code: string;
  expiresAt: string;
}

export interface CreateSessionOptions {
  accessPolicy: SessionAccessPolicy;
  password?: string;
}

export interface ApiError {
  error: string;
}

export function normalizeSessionCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, SESSION_CODE_LENGTH);
}

export function isSessionCode(value: string): boolean {
  return /^[A-Z0-9]{6}$/.test(value);
}
