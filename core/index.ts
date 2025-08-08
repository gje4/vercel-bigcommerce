import { ModelMessage, streamText } from 'ai';
import 'dotenv/config';
import * as readline from 'node:readline/promises';
 
const terminal = readline.createInterface({
input: process.stdin,
output: process.stdout,
});
 
const messages: ModelMessage[] = [];
 
async function main() {
while (true) {
const userInput = await terminal.question('You: ');
 
    messages.push({ role: 'user', content: userInput });
 
    const result = streamText({
      model: 'anthropic/claude-opus-4-20250514',
      messages,
    });
 
    let fullResponse = '';
    process.stdout.write('\nAssistant: ');
    for await (const delta of result.textStream) {
      fullResponse += delta;
      process.stdout.write(delta);
    }
    process.stdout.write('\n\n');
 
    messages.push({ role: 'assistant', content: fullResponse });
 
}
}
 
main().catch(console.error);