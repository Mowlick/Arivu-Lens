import { CreateMLCEngine, type MLCEngineInterface, type InitProgressReport } from "@mlc-ai/web-llm";

export class WebLLMRouter {
  private engine: MLCEngineInterface | null = null;
  private selectedModel = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

  /**
   * Initializes the WebGPU engine and downloads/restores the model.
   * @param onProgress Callback function reporting current cache progression status.
   */
  async initialize(onProgress: (progress: InitProgressReport) => void): Promise<void> {
    try {
      // Create and load the WebLLM engine with local IndexedDB caches
      this.engine = await CreateMLCEngine(this.selectedModel, {
        initProgressCallback: (report: InitProgressReport) => {
          onProgress(report);
        }
      });
      console.log("WebLLM WebGPU router model initialized successfully.");
    } catch (err) {
      console.warn("WebGPU not supported or model initialization failed. Falling back to pure server RAG: ", err);
      this.engine = null;
      throw err;
    }
  }

  /**
   * Evaluates a user chat prompt to decide where it should be processed.
   * @param prompt The user question.
   * @returns "local_chat" for in-browser instant answers, "graph_rag" for deep codebase retrieval.
   */
  async routePrompt(prompt: string): Promise<"local_chat" | "graph_rag"> {
    if (!this.engine) {
      // Graceful fallback to backend RAG if WebLLM is unavailable
      return "graph_rag";
    }

    const systemPrompt = 
      "You are a strict, instant Intent Router. Classify the user query into one of two options:\n" +
      "1. 'local_chat': If the user is asking a general programming question (e.g., 'write a quicksort', 'hello', 'what is an array'), basic math, or general logic that does NOT require scanning their local codebase.\n" +
      "2. 'graph_rag': If the user is asking specifically about functions, classes, database setups, workspace connections, imports, file trees, or bugs located inside their active codebase.\n\n" +
      "Reply with ONLY a single word: 'local_chat' or 'graph_rag'. Do not write explanations.";

    try {
      const response = await this.engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.0,
        max_tokens: 10
      });

      const choice = response.choices[0].message.content?.trim().toLowerCase();
      console.log(`WebLLM Intent Routing Decision: ${choice}`);
      
      if (choice?.includes("local_chat")) {
        return "local_chat";
      }
    } catch (err) {
      console.warn("Error running local WebLLM classification router:", err);
    }
    
    return "graph_rag";
  }

  /**
   * Generates a rapid in-browser response for simple developer questions.
   */
  async generateInstantChat(
    prompt: string, 
    onToken: (token: string) => void
  ): Promise<string> {
    if (!this.engine) {
      throw new Error("Router engine not initialized.");
    }

    let accumulatedText = "";
    
    try {
      const response = await this.engine.chat.completions.create({
        messages: [
          { 
            role: "system", 
            content: "You are a helpful, extremely fast coding assistant running inside the user's browser. Give a concise and clear technical answer." 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        stream: true
      });

      for await (const chunk of response) {
        const token = chunk.choices[0]?.delta.content || "";
        if (token) {
          accumulatedText += token;
          onToken(token);
        }
      }
    } catch (err) {
      console.warn("WebLLM streaming failed:", err);
      throw err;
    }

    return accumulatedText;
  }
}
