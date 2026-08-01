import type React from "react";
import { CopyPrompt } from "./CopyPrompt";
import { m } from "framer-motion";
import facts from "../src/facts.json";

/**
 * The agent-first section: mdflow assumes your first "user" is the coding
 * agent you already have open. Every card is a prompt (or one command) to
 * paste. The agent does the rest.
 */

const agentPrompts = (
	facts as typeof facts & {
		agentPrompts: { setup: string; evals: string; migrate: string };
	}
).agentPrompts;
const SETUP_PROMPT = agentPrompts.setup;

const SKILL_COMMAND = `npx skills add johnlindquist/mdflow`;

const EVALS_PROMPT = agentPrompts.evals;

const MIGRATE_PROMPT = agentPrompts.migrate;

export const AgentPrompts: React.FC = () => {
	return (
		<section
			id="agent-first"
			className="py-24 md:py-32 px-6 relative overflow-hidden border-t border-white/5"
		>
			<div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
			<div className="absolute top-[-30%] right-[-15%] w-[700px] h-[700px] bg-blue-600/10 blur-[150px] rounded-full pointer-events-none"></div>

			<div className="max-w-6xl mx-auto relative z-10">
				<m.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ duration: 0.6 }}
					className="text-center mb-16"
				>
					<p className="font-mono text-xs uppercase tracking-[0.3em] text-blue-400 mb-4">
						Agent-first
					</p>
					<h2 className="select-none font-display font-bold text-4xl md:text-6xl tracking-tighter text-white">
						LET YOUR AGENT
						<br />
						<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-white">
							SET IT UP.
						</span>
					</h2>
					<p className="mt-6 text-lg text-zinc-400 max-w-2xl mx-auto font-light">
						You already have an agent open. Paste one of these and let it build
						your ./flows roster, wire the engines, and add behavioral
						guardrails. You watch.
					</p>
				</m.div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<CopyPrompt
						index={0}
						accent="orange"
						title="Start my agent roster"
						description="Scaffolds flows, starter evals, and suggest-only evolution; then tailors them to your repo. Zero paid invocations until you say go."
						prompt={SETUP_PROMPT}
						shaderTarget="setup-prompt"
						shaderPriority={0.9}
					/>
					<CopyPrompt
						index={1}
						accent="blue"
						isCommand
						title="Install the mdflow skill"
						description="One command teaches your agent (Claude Code, Cursor, and friends) how to build and maintain your ./flows roster, wire the engine ladder, and ship evals. Permanently."
						prompt={SKILL_COMMAND}
						shaderTarget="skill-install"
						shaderPriority={0.8}
					/>
					<CopyPrompt
						index={2}
						accent="emerald"
						title="Add evals to every flow"
						description="Behavioral suites with repetition-aware plans and content-bound receipts. Cost is quoted before a paid invocation."
						prompt={EVALS_PROMPT}
					/>
					<CopyPrompt
						index={3}
						accent="pink"
						title="Migrate legacy flows"
						description="Loose files move into ./flows, tool: becomes engine:, and engine migrations follow the detected environment. Everything is inspected with free commands first."
						prompt={MIGRATE_PROMPT}
					/>
				</div>
			</div>
		</section>
	);
};
