import type {
  AppServerExit,
  AppServerStatus,
  ApprovalPolicy,
  BackendSnapshot,
  BrowserServerRequest,
  CollaborationModeKind,
  InitializeResponse,
  ReasoningEffort,
  RequestId,
  RpcError,
  SandboxPolicy,
  Thread,
  ThreadItem,
  ThreadSessionConfig,
  Turn,
  TurnStatus,
} from "./shared/codex.js";

export type ThreadMode = "replay" | "live";
export type ComposerAction = "send" | "steer" | "stop";

export interface PersistedUi {
  activeThreadId?: string | null;
  activeMode?: ThreadMode;
  currentProject?: string;
  customProjects?: string[];
  draftThreads?: Thread[];
  composerDrafts?: Record<string, string>;
  defaultPermissionMode?: "standard" | "full";
  threadControlDrafts?: Record<string, ComposerControlDraft>;
  threadPermissionBaselines?: Record<string, PermissionBaseline>;
}

export interface TagDefinition {
  name: string;
  color: string;
}

export interface ProjectThreadState {
  archived?: boolean;
  tags?: string[];
}

export interface ComposerControlDraft {
  mode: CollaborationModeKind;
  model: string;
  effort: ReasoningEffort | null;
  fullAccess: boolean;
  updatedAt?: number;
}

export interface ModelChoice {
  displayName: string;
  model: string;
}

export interface PermissionBaseline {
  approvalPolicy: ApprovalPolicy;
  sandbox: SandboxPolicy;
}

export interface ProjectStateEntry {
  id: string;
  name: string;
}

export interface RequestResponseBody {
  result?: unknown;
  error?: RpcError;
}

export interface ThreadListResponse {
  data: Thread[];
  nextCursor: string | null;
}

export interface ThreadResponse {
  thread: Thread;
}

export interface ThreadSessionResponse extends ThreadResponse, ThreadSessionConfig {
  approvalsReviewer: string;
  modelProvider: string;
  serviceTier: string | null;
}

export type ThreadStartResponse = ThreadSessionResponse;
export type ThreadResumeResponse = ThreadSessionResponse;

export interface TurnStartResponse {
  turn: Turn;
}

export interface TurnSteerResponse {
  turnId: string;
}

export interface TurnStartOptions {
  approvalPolicy?: ApprovalPolicy | null;
  sandboxPolicy?: SandboxPolicy | null;
  collaborationMode?: {
    mode: CollaborationModeKind;
    settings: {
      model: string;
      reasoning_effort: ReasoningEffort | null;
      developer_instructions: string | null;
    };
  } | null;
}

export interface ModelReasoningEffortOption {
  description: string;
  reasoningEffort: ReasoningEffort;
}

export interface ModelOption {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: ModelReasoningEffortOption[];
}

export interface ModelListResponse {
  data: ModelOption[];
  nextCursor: string | null;
}

export interface ProjectStateResponse {
  projects: ProjectStateEntry[];
  hidden: string[];
  iconIds: string[];
  tags: TagDefinition[];
}

export interface ProjectStateSaveData {
  projects: ProjectStateEntry[];
  hidden: string[];
  tags: TagDefinition[];
}

export interface ProjectSessionStateResponse {
  threads: Record<string, ProjectThreadState>;
}

export interface ProjectSessionStateSaveData {
  threads: Record<string, ProjectThreadState>;
}

export interface AppStore {
  backendStatus: AppServerStatus;
  initializeResponse: InitializeResponse | null;
  stderrTail: string[];
  lastExit: AppServerExit;
  threadsById: Record<string, Thread>;
  threadSessionConfigById: Record<string, ThreadSessionConfig>;
  threadOrder: string[];
  turnsById: Record<string, Turn>;
  turnOrderByThreadId: Record<string, string[]>;
  itemsById: Record<string, ThreadItem>;
  itemOrderByTurnId: Record<string, string[]>;
  activeThreadId: string | null;
  threadModes: Record<string, ThreadMode>;
  liveAttachedThreadIds: Record<string, true>;
  activeTurnIdByThreadId: Record<string, string>;
  pendingServerRequestsById: Record<string, BrowserServerRequest>;
  selectedThreadError: string | null;
  nonSteerableThreadIds: Record<string, boolean>;
  unreadThreadIds: Record<string, true>;
  setSnapshot: (snapshot: BackendSnapshot) => void;
  replaceThreads: (threads: Thread[]) => void;
  hydrateThread: (thread: Thread, mode: ThreadMode, sessionConfig?: ThreadSessionConfig | null) => void;
  setActiveThread: (threadId: string | null) => void;
  setSelectedThreadError: (message: string | null) => void;
  clearThreadUnread: (threadId: string) => void;
  setThreadSessionConfig: (threadId: string, sessionConfig: ThreadSessionConfig) => void;
  updateThreadName: (threadId: string, name: string | null) => void;
  removeThread: (threadId: string) => void;
  noteTurn: (threadId: string, turn: Turn) => void;
  applyNotification: (method: string, params: unknown) => void;
  putServerRequest: (request: BrowserServerRequest) => void;
  markNonSteerable: (threadId: string, value: boolean) => void;
}

export interface SessionRowProps {
  threadId: string;
  active: boolean;
  tags: TagDefinition[];
  showUnread: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
}

export interface TranscriptViewProps {
  threadId: string;
  respondingRequestKey: string | null;
  onRespond: (request: BrowserServerRequest, body: RequestResponseBody) => Promise<void>;
  onForkMessage: (threadId: string, turnId: string, itemId: string) => void;
}

export interface TurnBlockProps extends TranscriptViewProps {
  turnId: string;
}

export interface TranscriptItemCardProps extends TurnBlockProps {
  itemId: string;
}

export interface ApprovalCardProps {
  request: BrowserServerRequest;
  disabled: boolean;
  onRespond: (request: BrowserServerRequest, body: RequestResponseBody) => Promise<void>;
  relatedItem?: ThreadItem;
}

export interface TranscriptItemBodyProps {
  item: ThreadItem;
}

export interface MarkdownBlockProps {
  text: string;
  preserveNewlines?: boolean;
}

export interface CopyMessageButtonProps {
  text: string;
  className?: string;
}

export interface ForkMessageButtonProps {
  className?: string;
  onClick: () => void;
}

export interface ComposerActionIconProps {
  action: ComposerAction;
}

export interface PermissionShieldIconProps {
  active: boolean;
}

export interface ThreadHeaderProps {
  thread: Thread;
  currentThreadIsUiDraft: boolean;
  archived: boolean;
  availableTags: TagDefinition[];
  tags: TagDefinition[];
  onRename: (name: string) => Promise<void>;
  onDeleteDraft: () => void;
  onToggleArchived: () => void;
  onToggleTag: (tagName: string) => void;
  onCreateTag: (name: string, color: string) => string | null;
}

export interface ThreadComposerProps {
  activeThreadId: string | null;
  currentThread: Thread | null;
  isLive: boolean;
  composerValue: string;
  composerControlDraft: ComposerControlDraft | null;
  composerAction: ComposerAction;
  composerActionDisabled: boolean;
  composerControlsDisabled: boolean;
  modelChoices: ModelChoice[];
  modelsLoading: boolean;
  reasoningOptions: ModelReasoningEffortOption[];
  selectedModel: ModelOption | null;
  focusToken: number;
  onChangeComposer: (value: string) => void;
  onSubmit: () => void;
  onInterrupt: () => void;
  onSelectMode: (mode: CollaborationModeKind) => void;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: ReasoningEffort) => void;
  onToggleFullAccess: () => void;
}

export interface ProjectContextMenuState {
  project: string;
  x: number;
  y: number;
}

export interface ProjectSidebarProps {
  activeThreadId: string | null;
  availableTags: TagDefinition[];
  backendStatus: AppServerStatus;
  currentProject: string;
   envHome: string;
  hiddenProjects: string[];
  listLoading: boolean;
  overflowProjects: string[];
  projectIconVersions: Record<string, number>;
  projectOptions: string[];
  projectState: ProjectStateEntry[];
  sessionStateByThreadId: Record<string, ProjectThreadState>;
  threadOrder: string[];
  threadsById: Record<string, Thread>;
  visibleProjects: string[];
  onAddProject: (project: string) => void;
  onHideProject: (project: string) => void;
  onOpenThread: (threadId: string, mode: ThreadMode) => void;
  onRemoveProject: (project: string) => void;
  onRemoveProjectIcon: (project: string) => Promise<void>;
  onReorderProjects: (projects: string[]) => void;
  onSaveProjectName: (project: string, name: string) => void;
  onSelectProject: (project: string) => void;
  onStartThread: () => void;
  onUnhideProject: (project: string) => void;
  onUploadProjectIcon: (project: string, file: File) => Promise<void>;
  onToggleThreadDone: (threadId: string) => void;
}

export interface ProjectContextMenuProps {
  contextMenuProject: ProjectContextMenuState | null;
  projectState: ProjectStateEntry[];
  onClose: () => void;
  onDeleteProject: (project: string) => void;
  onEditProject: (project: string) => void;
  onHideProject: (project: string) => void;
  projectHasSessions: (project: string) => boolean;
}

export interface AddProjectModalProps {
  onAddProject: (project: string) => void;
  onClose: () => void;
}

export interface EditProjectModalProps {
  project: string;
  projectIconVersion?: number;
  onClose: () => void;
  onRemoveProjectIcon: (project: string) => Promise<void>;
  onSaveProjectName: (project: string, name: string) => void;
  onUploadProjectIcon: (project: string, file: File) => Promise<void>;
  projectDisplayName: string;
}

export interface AuthModalProps {
  errorMessage: string | null;
  onSubmit: (token: string) => void;
}

export interface ProjectSidebarSession {
  id: string;
  cwd: string;
  name: string | null;
  preview: string;
  updatedAt: number;
  running: boolean;
}

export interface TurnAgentCopyContext {
  items: ThreadItem[];
  status: TurnStatus | undefined;
}

export interface ServerRequestResponsePayload {
  requestId: RequestId;
  result?: unknown;
  error?: RpcError;
}

export interface UseBackendInitializationOptions {
  backendStatus: AppServerStatus;
  enabled: boolean;
  replaceThreads: (threads: Thread[]) => void;
  setActionError: (message: string | null) => void;
  setSnapshot: (snapshot: BackendSnapshot) => void;
}

export interface UseAuthOptions {
  clearErrors: () => void;
}

export interface UseAuthResult {
  authBlocked: boolean;
  authBootstrapped: boolean;
  authError: string | null;
  submitAuthToken: (token: string) => void;
}

export interface UseProjectManagerOptions {
  initialUi: PersistedUi;
  onOpenThread: (threadId: string, mode: ThreadMode) => Promise<void>;
  setActionError: (message: string | null) => void;
  setActiveThread: (threadId: string | null) => void;
  threadOrder: string[];
  threadsById: Record<string, Thread>;
}

export interface UseComposerStateOptions {
  activeThreadId: string | null;
  activeTurnId: string | null;
  backendStatus: AppServerStatus;
  currentMode: ThreadMode;
  currentThread: Thread | null;
  currentThreadSessionConfig: ThreadSessionConfig | null;
  currentWaitingFlags: Array<"waitingOnApproval" | "waitingOnUserInput">;
  initialUi: PersistedUi;
  isCurrentThreadNonSteerable: boolean;
  setActionError: (message: string | null) => void;
}
