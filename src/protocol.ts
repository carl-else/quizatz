export const SESSION_CODE_LENGTH = 6;
export const SESSION_LEASE_MS = 24 * 60 * 60 * 1000;

export type SessionAccessPolicy = "anonymous" | "named";

export interface SingleChoiceOption {
  id: string;
  text: string;
}

export interface SingleChoiceQuestion {
  id: string;
  text: string;
  options: SingleChoiceOption[];
}

export interface StartQuestionCommand {
  type: "start-question";
  question: {
    text: string;
    options: string[];
  };
}

export interface AnswerQuestionCommand {
  type: "answer-question";
  optionId: string;
}

export interface CloseQuestionCommand {
  type: "close-question";
}

export interface RevealQuestionCommand {
  type: "reveal-question";
}

export type QuestionState = "upcoming" | "active" | "closed" | "revealed";

export interface SingleChoiceResult {
  options: Array<SingleChoiceOption & { responseCount: number; percentage: number }>;
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
  question: SingleChoiceQuestion;
}

export interface ClosedQuestionSnapshot {
  type: "closed-question";
  question: SingleChoiceQuestion;
}

export interface RevealedQuestionSnapshot {
  type: "revealed-question";
  question: SingleChoiceQuestion;
  result: SingleChoiceResult;
}

export interface AnswerAcceptedMessage {
  type: "answer-accepted";
  optionId: string;
}

export type LobbyMessage =
  | LobbySnapshot
  | ActiveQuestionSnapshot
  | ClosedQuestionSnapshot
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
