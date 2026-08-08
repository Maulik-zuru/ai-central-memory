export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface ParsedConversation {
  externalId?: string;
  title: string;
  messages: ParsedMessage[];
}

export interface ConversationImportProvider {
  platform: string;
  parse(buffer: Buffer): ParsedConversation[];
}

// Real ChatGPT `conversations.json` export shape: a tree of nodes (`mapping`) rather than a flat
// list, to support edit/regenerate branches. Phase5_Implementation_Plan.md §3 explicitly scopes
// this phase to linearizing to the single active branch — walking parent->children following
// `current_node` back to the root, not reconstructing every edit branch.
interface ChatGptNode {
  id: string;
  message?: {
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
    create_time?: number | null;
  } | null;
  parent?: string | null;
  children?: string[];
}

interface ChatGptExportEntry {
  title?: string;
  create_time?: number;
  current_node?: string;
  mapping: Record<string, ChatGptNode>;
}

function partsToText(parts: unknown[] | undefined): string {
  if (!parts) return '';
  return parts
    .filter((p): p is string => typeof p === 'string')
    .join('\n')
    .trim();
}

export const chatGptImportProvider: ConversationImportProvider = {
  platform: 'chatgpt',
  parse(buffer: Buffer): ParsedConversation[] {
    const raw = JSON.parse(buffer.toString('utf-8'));
    const entries: ChatGptExportEntry[] = Array.isArray(raw) ? raw : [raw];

    return entries
      .map((entry): ParsedConversation | null => {
        const mapping = entry.mapping ?? {};
        // Walk from current_node (the tip of the active branch) back to the root via `parent`,
        // then reverse — this is the "single active branch" linearization the plan calls for.
        const chain: ChatGptNode[] = [];
        let nodeId = entry.current_node ?? Object.keys(mapping).find((id) => !mapping[id].parent);
        const seen = new Set<string>();
        while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
          seen.add(nodeId);
          chain.push(mapping[nodeId]);
          nodeId = mapping[nodeId].parent ?? undefined;
        }
        chain.reverse();

        const messages: ParsedMessage[] = chain
          .map((node) => node.message)
          .filter((m): m is NonNullable<ChatGptNode['message']> => Boolean(m))
          .filter((m) => m.author?.role === 'user' || m.author?.role === 'assistant')
          .map((m) => ({
            role: m.author!.role as 'user' | 'assistant',
            content: partsToText(m.content?.parts),
            createdAt: m.create_time ? new Date(m.create_time * 1000) : new Date(),
          }))
          .filter((m) => m.content.length > 0);

        if (messages.length === 0) return null;

        return {
          title: entry.title || messages[0].content.slice(0, 60) || 'Untitled conversation',
          messages,
        };
      })
      .filter((c): c is ParsedConversation => c !== null);
  },
};

// Anthropic (claude.ai) export shape is a flatter { uuid, name, chat_messages: [{ sender, text,
// created_at }] } — no branching tree, so no linearization step is needed.
interface ClaudeExportEntry {
  uuid?: string;
  name?: string;
  chat_messages?: { sender?: string; text?: string; created_at?: string }[];
}

export const claudeImportProvider: ConversationImportProvider = {
  platform: 'claude',
  parse(buffer: Buffer): ParsedConversation[] {
    const raw = JSON.parse(buffer.toString('utf-8'));
    const entries: ClaudeExportEntry[] = Array.isArray(raw) ? raw : [raw];

    return entries
      .map((entry): ParsedConversation | null => {
        const messages: ParsedMessage[] = (entry.chat_messages ?? [])
          .filter((m) => m.sender === 'human' || m.sender === 'assistant')
          .map((m) => ({
            role: (m.sender === 'human' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: (m.text ?? '').trim(),
            createdAt: m.created_at ? new Date(m.created_at) : new Date(),
          }))
          .filter((m) => m.content.length > 0);

        if (messages.length === 0) return null;

        return {
          externalId: entry.uuid,
          title: entry.name || messages[0].content.slice(0, 60) || 'Untitled conversation',
          messages,
        };
      })
      .filter((c): c is ParsedConversation => c !== null);
  },
};

const PROVIDERS: Record<string, ConversationImportProvider> = {
  chatgpt: chatGptImportProvider,
  claude: claudeImportProvider,
};

/** Gemini/TypingMind/Grok/DeepSeek are a documented gap (Phase5_Implementation_Plan.md §3) — no
 * verified export format to parse against yet, not a silent guess shipped as if it worked. */
export const SUPPORTED_IMPORT_PLATFORMS = Object.keys(PROVIDERS);

export function getConversationImportProvider(platform: string): ConversationImportProvider | undefined {
  return PROVIDERS[platform];
}
