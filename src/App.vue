<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  LogIn,
  Radio,
  Users,
} from "@lucide/vue";
import { signInOrganizer } from "./auth";
import { connectToLobby, createLiveSession, type LobbyConnection } from "./lobby";
import {
  isSessionCode,
  normalizeSessionCode,
  type LobbySnapshot,
  type OpenEndedResult,
  type Question,
  type QuestionState,
  type SessionAccessPolicy,
  type SingleChoiceResult,
  type SingleChoiceQuestion,
} from "./protocol";

type View = "home" | "organizer" | "participant";

const view = ref<View>("home");
const sessionCode = ref("");
const organizerName = ref("");
const organizerToken = ref("");
const snapshot = ref<LobbySnapshot>();
const activeQuestion = ref<Question>();
const questionState = ref<QuestionState>();
const questionResult = ref<SingleChoiceResult | OpenEndedResult>();
const selectedOptionId = ref("");
const openEndedAnswer = ref("");
const hasSubmittedOpenEndedAnswer = ref(false);
const answerStatus = ref("");
const busy = ref(false);
const error = ref("");
const copied = ref(false);
const accessPolicy = ref<SessionAccessPolicy>("anonymous");
const password = ref("");
const questionText = ref("");
const questionKind = ref<"single-choice" | "open-ended">("single-choice");
const questionOptions = ref(["", ""]);
const homeUrl = import.meta.env.BASE_URL;
let socket: LobbyConnection | undefined;

const participantCount = computed(() => snapshot.value?.participantCount ?? 0);
const singleChoiceResult = computed(() => {
  const result = questionResult.value;
  return result && "options" in result ? result : undefined;
});
const openEndedResult = computed(() => {
  const result = questionResult.value;
  return result && "entries" in result ? result : undefined;
});
const shareUrl = computed(() => {
  if (!sessionCode.value) return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("session", sessionCode.value);
  return url.toString();
});

function setCode(event: Event) {
  sessionCode.value = normalizeSessionCode((event.target as HTMLInputElement).value);
}

function useSocket(accessToken?: string) {
  socket?.close(1000, "Changing view");
  socket = connectToLobby(
    sessionCode.value,
    accessToken,
    password.value || undefined,
    (nextSnapshot) => {
      if (nextSnapshot.type === "lobby") {
        snapshot.value = nextSnapshot;
        activeQuestion.value = undefined;
        questionState.value = undefined;
        questionResult.value = undefined;
      } else if (nextSnapshot.type === "active-question") {
        if (activeQuestion.value?.id !== nextSnapshot.question.id) {
          selectedOptionId.value = "";
          openEndedAnswer.value = "";
          hasSubmittedOpenEndedAnswer.value = false;
          answerStatus.value = "";
        }
        snapshot.value = undefined;
        activeQuestion.value = nextSnapshot.question;
        questionState.value = "active";
        questionResult.value = undefined;
      } else if (nextSnapshot.type === "closed-question") {
        snapshot.value = undefined;
        activeQuestion.value = nextSnapshot.question;
        questionState.value = "closed";
        questionResult.value = undefined;
      } else if (nextSnapshot.type === "closed-open-ended-question") {
        snapshot.value = undefined;
        activeQuestion.value = nextSnapshot.question;
        questionState.value = "closed";
        questionResult.value = nextSnapshot.result;
      } else if (nextSnapshot.type === "revealed-question") {
        snapshot.value = undefined;
        activeQuestion.value = nextSnapshot.question;
        questionState.value = "revealed";
        questionResult.value = nextSnapshot.result;
      }
      error.value = "";
    },
    (message) => {
      error.value = message;
    },
    () => {
      view.value = "home";
      error.value = "Enter the password to join this live session.";
    },
    () => {
      view.value = "home";
      error.value = "Sign in to join this live session.";
    },
    (answer) => {
      if (answer.optionId && activeQuestion.value?.kind === "single-choice") {
        const option = activeQuestion.value.options.find((candidate) => candidate.id === answer.optionId);
        answerStatus.value = option ? `Answer saved: ${option.text}.` : "Answer saved.";
      } else if (answer.text) {
        hasSubmittedOpenEndedAnswer.value = true;
        answerStatus.value = "Answer saved.";
      }
    },
  );
}

function startQuestion() {
  if (!questionText.value.trim()) {
    error.value = "Enter a question.";
    return;
  }
  if (questionKind.value === "open-ended") {
    error.value = "";
    socket?.startQuestion({ kind: "open-ended", text: questionText.value.trim() });
    return;
  }
  const options = questionOptions.value.map((option) => option.trim());
  if (options.length < 2 || options.length > 8 || options.some((option) => !option)) {
    error.value = "Enter a question and between two and eight options.";
    return;
  }
  error.value = "";
  socket?.startQuestion({ kind: "single-choice", text: questionText.value.trim(), options });
}

function addQuestionOption() {
  if (questionOptions.value.length < 8) questionOptions.value.push("");
}

function answerQuestion(optionId: string) {
  socket?.answerSingleChoiceQuestion(optionId);
}

function submitOpenEndedAnswer() {
  const answer = openEndedAnswer.value.trim();
  if (!answer) {
    error.value = "Enter an answer.";
    return;
  }
  error.value = "";
  socket?.answerOpenEndedQuestion(answer);
}

function mergeOpenEndedResult(sourceText: string, targetText: string) {
  socket?.mergeOpenEndedResult(sourceText, targetText);
}

function closeQuestion() {
  socket?.closeQuestion();
}

function revealQuestion() {
  socket?.revealQuestion();
}

async function createSession() {
  busy.value = true;
  error.value = "";
  try {
    const identity = await signInOrganizer();
    organizerName.value = identity.displayName;
    organizerToken.value = identity.accessToken;
    const created = await createLiveSession(identity.accessToken, {
      accessPolicy: accessPolicy.value,
      password: password.value || undefined,
    });
    sessionCode.value = created.code;
    view.value = "organizer";
    useSocket(identity.accessToken);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not create the live session.";
  } finally {
    busy.value = false;
  }
}

function joinSession() {
  error.value = "";
  if (!isSessionCode(sessionCode.value)) {
    error.value = "Enter a six-character session code.";
    return;
  }
  view.value = "participant";
  useSocket();
}

async function joinNamedSession() {
  if (!isSessionCode(sessionCode.value)) {
    error.value = "Enter a six-character session code.";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const identity = await signInOrganizer();
    view.value = "participant";
    useSocket(identity.accessToken);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not sign in to join the live session.";
  } finally {
    busy.value = false;
  }
}

function leaveLobby() {
  socket?.close(1000, "Left lobby");
  socket = undefined;
  snapshot.value = undefined;
  activeQuestion.value = undefined;
  questionState.value = undefined;
  questionResult.value = undefined;
  selectedOptionId.value = "";
  openEndedAnswer.value = "";
  hasSubmittedOpenEndedAnswer.value = false;
  answerStatus.value = "";
  organizerToken.value = "";
  error.value = "";
  view.value = "home";
}

async function copyShareUrl() {
  await navigator.clipboard.writeText(shareUrl.value);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1600);
}

onMounted(() => {
  const linkedCode = normalizeSessionCode(new URL(window.location.href).searchParams.get("session") ?? "");
  if (isSessionCode(linkedCode)) {
    sessionCode.value = linkedCode;
    joinSession();
  }
});

onBeforeUnmount(() => socket?.close(1000, "Page closed"));
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button v-if="view !== 'home'" class="icon-button" type="button" title="Leave lobby" @click="leaveLobby">
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <a v-else class="wordmark" :href="homeUrl" aria-label="Quizatz home">
        <span class="wordmark-mark">Q</span>
        <span>Quizatz</span>
      </a>
      <div class="connection-mark"><Radio :size="16" aria-hidden="true" /> Live</div>
    </header>

    <main v-if="view === 'home'" class="home-view">
      <section class="intro">
        <p class="eyebrow">Live questioning</p>
        <h1>Quizatz</h1>
        <p class="lede">Start or join a live session.</p>
      </section>

      <div class="action-grid">
        <section class="action-pane organizer-pane" aria-labelledby="create-title">
          <div>
            <span class="pane-number">01</span>
            <h2 id="create-title">Create a session</h2>
            <p>Sign in with your work or school Microsoft account.</p>
          </div>
          <div class="policy-fields">
            <div>
              <span class="field-label">Participation</span>
              <div class="segmented-control" role="group" aria-label="Participation policy">
                <button
                  type="button"
                  :aria-pressed="accessPolicy === 'anonymous'"
                  :class="{ selected: accessPolicy === 'anonymous' }"
                  @click="accessPolicy = 'anonymous'"
                >Anonymous</button>
                <button
                  type="button"
                  :aria-pressed="accessPolicy === 'named'"
                  :class="{ selected: accessPolicy === 'named' }"
                  @click="accessPolicy = 'named'"
                >Named</button>
              </div>
            </div>
            <label class="password-field" for="create-password">
              Password <span>(optional)</span>
              <input id="create-password" v-model="password" type="password" maxlength="128" autocomplete="new-password" />
            </label>
          </div>
          <button class="primary-button ink-button" type="button" :disabled="busy" @click="createSession">
            <LogIn :size="19" aria-hidden="true" />
            {{ busy ? "Signing in..." : "Sign in and create" }}
          </button>
        </section>

        <section class="action-pane participant-pane" aria-labelledby="join-title">
          <div>
            <span class="pane-number">02</span>
            <h2 id="join-title">Join a session</h2>
            <p>No account needed for anonymous participation.</p>
          </div>
          <form class="join-form" @submit.prevent="joinSession">
            <label for="session-code">Session code</label>
            <div class="code-entry">
              <input
                id="session-code"
                :value="sessionCode"
                maxlength="6"
                autocomplete="off"
                inputmode="text"
                placeholder="ABC234"
                @input="setCode"
              />
              <button class="icon-button submit-code" type="submit" title="Join session">
                <ArrowRight :size="21" aria-hidden="true" />
              </button>
            </div>
            <label class="password-field" for="join-password">
              Password <span>(if required)</span>
              <input id="join-password" v-model="password" type="password" maxlength="128" autocomplete="current-password" />
            </label>
          </form>
          <button class="secondary-button" type="button" :disabled="busy" @click="joinNamedSession">
            <LogIn :size="19" aria-hidden="true" />
            {{ busy ? "Signing in..." : "Sign in to join" }}
          </button>
        </section>
      </div>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    </main>

    <main v-else-if="view === 'organizer'" class="lobby-view organizer-lobby">
      <section class="lobby-heading">
        <p class="eyebrow">Organizer lobby</p>
        <h1>People can join now.</h1>
        <p class="signed-in">Signed in as {{ organizerName }}</p>
      </section>

      <section class="session-details" aria-label="Session details">
        <div class="session-code-block">
          <span>Session code</span>
          <strong data-testid="session-code">{{ sessionCode }}</strong>
        </div>
        <div class="share-block">
          <label for="share-url">Share link</label>
          <div class="share-field">
            <input id="share-url" :value="shareUrl" readonly />
            <button class="icon-button" type="button" :title="copied ? 'Copied' : 'Copy share link'" @click="copyShareUrl">
              <Check v-if="copied" :size="19" aria-hidden="true" />
              <Copy v-else :size="19" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <section class="count-stage" aria-live="polite">
        <Users :size="30" aria-hidden="true" />
        <strong data-testid="participant-count">{{ participantCount }}</strong>
        <span>{{ participantCount === 1 ? "participant" : "participants" }} in the lobby</span>
      </section>
      <section v-if="snapshot" class="question-authoring" aria-labelledby="question-title">
        <p class="eyebrow">First question</p>
        <h2 id="question-title">Ask a question</h2>
        <div class="segmented-control" role="group" aria-label="Question type">
          <button
            type="button"
            :aria-pressed="questionKind === 'single-choice'"
            :class="{ selected: questionKind === 'single-choice' }"
            @click="questionKind = 'single-choice'"
          >Single choice</button>
          <button
            type="button"
            :aria-pressed="questionKind === 'open-ended'"
            :class="{ selected: questionKind === 'open-ended' }"
            @click="questionKind = 'open-ended'"
          >Open-ended</button>
        </div>
        <form class="question-form" @submit.prevent="startQuestion">
          <label for="question-text">Question</label>
          <input id="question-text" v-model="questionText" />
          <template v-if="questionKind === 'single-choice'">
            <label v-for="(_, index) in questionOptions" :key="index" :for="`question-option-${index}`">
              Option {{ index + 1 }}
              <input :id="`question-option-${index}`" v-model="questionOptions[index]" />
            </label>
            <button class="secondary-button" type="button" :disabled="questionOptions.length === 8" @click="addQuestionOption">
              Add option
            </button>
          </template>
          <button class="primary-button ink-button" type="submit">Start question</button>
        </form>
      </section>
      <section v-else-if="activeQuestion" class="active-question" aria-live="polite">
        <p class="eyebrow">Active question</p>
        <h2>{{ activeQuestion.text }}</h2>
        <button v-if="questionState === 'active'" class="primary-button ink-button" type="button" @click="closeQuestion">
          Close question
        </button>
        <button v-else-if="questionState === 'closed'" class="primary-button ink-button" type="button" @click="revealQuestion">
          Reveal result
        </button>
        <template v-if="questionState === 'closed' && activeQuestion.kind === 'open-ended' && openEndedResult">
          <h3>Consolidate responses</h3>
          <ul aria-label="Open-ended results to consolidate">
            <li v-for="entry in openEndedResult.entries" :key="entry.text">
              <span>{{ entry.text }}: {{ entry.responseCount }} {{ entry.responseCount === 1 ? "response" : "responses" }}</span>
              <button
                v-for="target in openEndedResult.entries.filter((candidate) => candidate.text !== entry.text)"
                :key="target.text"
                class="secondary-button"
                type="button"
                @click="mergeOpenEndedResult(entry.text, target.text)"
              >Merge {{ entry.text }} into {{ target.text }}</button>
            </li>
          </ul>
        </template>
        <template v-else-if="questionState === 'revealed' && activeQuestion.kind === 'open-ended' && openEndedResult">
          <ul aria-label="Open-ended result">
            <li v-for="entry in openEndedResult.entries" :key="entry.text">
              {{ entry.text }}: {{ entry.responseCount }} {{ entry.responseCount === 1 ? "response" : "responses" }}
            </li>
          </ul>
        </template>
      </section>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    </main>

    <main v-else class="lobby-view participant-lobby">
      <section class="participant-status">
        <div class="pulse" aria-hidden="true"><span></span></div>
        <p class="eyebrow">Session {{ sessionCode }}</p>
        <template v-if="activeQuestion && questionState === 'active'">
          <h1>{{ activeQuestion.text }}</h1>
          <fieldset v-if="activeQuestion.kind === 'single-choice'" class="answer-options">
            <legend>Choose one answer</legend>
            <label v-for="option in activeQuestion.options" :key="option.id">
              <input v-model="selectedOptionId" type="radio" name="answer" :value="option.id" @change="answerQuestion(option.id)" />
              {{ option.text }}
            </label>
          </fieldset>
          <form v-else class="question-form" @submit.prevent="submitOpenEndedAnswer">
            <label for="open-ended-answer">Your answer</label>
            <input id="open-ended-answer" v-model="openEndedAnswer" maxlength="500" />
            <button class="primary-button ink-button" type="submit">
              {{ hasSubmittedOpenEndedAnswer ? "Update answer" : "Submit answer" }}
            </button>
          </form>
          <p v-if="answerStatus" role="status">{{ answerStatus }}</p>
        </template>
        <template v-else-if="activeQuestion && questionState === 'closed'">
          <h1>{{ activeQuestion.text }}</h1>
          <p>Responses are closed.</p>
        </template>
        <template v-else-if="activeQuestion && activeQuestion.kind === 'single-choice' && questionState === 'revealed' && singleChoiceResult">
          <h1>{{ activeQuestion.text }}</h1>
          <div class="result-chart" aria-label="Single-choice result">
            <div v-for="option in singleChoiceResult.options" :key="option.id" class="result-bar">
              <div class="result-bar-label">
                <span>{{ option.text }}</span>
                <span>{{ option.responseCount }} {{ option.responseCount === 1 ? "response" : "responses" }} ({{ option.percentage }}%)</span>
              </div>
              <div
                class="result-bar-track"
                role="progressbar"
                :aria-label="`${option.text}: ${option.responseCount} ${option.responseCount === 1 ? 'response' : 'responses'} (${option.percentage}%)`"
                :aria-valuenow="option.percentage"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span class="result-bar-fill" :style="{ width: `${option.percentage}%` }"></span>
              </div>
            </div>
          </div>
          <p>{{ singleChoiceResult.totalResponseCount }} {{ singleChoiceResult.totalResponseCount === 1 ? "response" : "responses" }} total</p>
        </template>
        <template v-else-if="activeQuestion && activeQuestion.kind === 'open-ended' && questionState === 'revealed' && openEndedResult">
          <h1>{{ activeQuestion.text }}</h1>
          <ol aria-label="Open-ended result">
            <li v-for="entry in openEndedResult.entries" :key="entry.text">
              {{ entry.text }}: {{ entry.responseCount }} {{ entry.responseCount === 1 ? "response" : "responses" }}
            </li>
          </ol>
          <p>{{ openEndedResult.totalResponseCount }} {{ openEndedResult.totalResponseCount === 1 ? "response" : "responses" }} total</p>
        </template>
        <h1 v-else-if="snapshot">You’re in.</h1>
        <h1 v-else>Joining...</h1>
        <p v-if="snapshot">Waiting for the organizer to begin.</p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      </section>
    </main>
  </div>
</template>
