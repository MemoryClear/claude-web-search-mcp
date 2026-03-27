// Type definitions for Claude Web Search MCP Server

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  links: string[];
  images: string[];
  metadata: {
    description?: string;
    author?: string;
    published?: string;
  };
}

export interface SearchOptions {
  num_results?: number;
  query: string;
}

export interface ScrapeOptions {
  url: string;
  extract_links?: boolean;
  extract_images?: boolean;
}

export interface SearchProvider {
  name: string;
  search(query: string, numResults: number): Promise<SearchResult[]>;
  isEnabled(): boolean;
}

export interface Config {
  search: {
    providers: ProviderConfig[];
  };
  scraping: {
    user_agent: string;
    timeout_ms: number;
    max_content_length: number;
    remove_selectors: string[];
  };
}

export interface ProviderConfig {
  name: string;
  enabled: boolean;
  api_key?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}
