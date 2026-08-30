import { promptFor } from "../../lib/prompts";

/**
 * A product-facing explanation. Raw prompts and evaluator controls remain in
 * the private evaluation repository boundary.
 */
export function TaskPrompt({ taskId, taskName }: { taskId: string; taskName: string }) {
  const prompt = promptFor(taskId);
  if (!prompt) return null;

  return (
    <details className="prompt">
      <summary>
        <span className="prompt__title">What agents were asked to make</span>
      </summary>
      <p className="prompt__note">A reviewed public description of the {taskName} task.</p>
      <pre className="prompt__text" tabIndex={0} role="region" aria-label={`Task description for ${taskName}`}>{prompt.text}</pre>
    </details>
  );
}
