// Claude Web Search MCP Server - Main Entry Point

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config';
import { webSearchTool, handleWebSearch } from './tools/search';
import { webScrapeTool, handleWebScrape } from './tools/scrape';
import { logger } from './utils/logger';

const TOOLS = [webSearchTool, webScrapeTool];

class WebSearchMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'claude-web-search',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('mcp', 'Listing tools');
      return {
        tools: TOOLS.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      logger.info('mcp', `Tool call: ${name}`);

      try {
        switch (name) {
          case 'web_search':
            return await handleWebSearch(args as { query: string; num_results?: number });

          case 'web_scrape':
            return await handleWebScrape(args as { url: string; extract_links?: boolean; extract_images?: boolean });

          default:
            logger.warn('mcp', `Unknown tool: ${name}`);
            return {
              content: [{ type: 'text', text: `Unknown tool: ${name}` }],
              isError: true,
            };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('mcp', `Tool error: ${message}`);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    logger.info('mcp', 'Starting Web Search MCP Server...');
    
    await this.server.connect(transport);
    logger.info('mcp', 'Server connected and ready');
  }
}

// Initialize and start
const configPath = process.env.CONFIG_PATH;
loadConfig(configPath);

const server = new WebSearchMCPServer();
server.start().catch((error) => {
  logger.error('mcp', 'Failed to start server:', error);
  process.exit(1);
});
