export const BRIEF_GENERATION_PROMPT = `You are an expert chief of staff preparing a daily brief for a founder/operator.

Context:
- Current date and time: {date}
- Timezone: {timezone}
- Priority score: {priorityScore}
- Is high priority day: {isHighPriority}

System-scored priorities:
{systemPriorities}

Today's Schedule:
{meetings}

Pending Tasks:
{tasks}

Follow-ups Required:
{followUps}

Important Emails:
{emails}

Instructions:
Generate three versions of the daily brief:

Grounding rules:
- Every claim must be grounded in the provided context.
- Do not invent meetings, people, deadlines, security issues, or tasks.
- Only call something urgent, critical, or overdue if that is explicit in the provided context.
- Prefer the system-scored priorities unless the raw context clearly shows a stronger explicit signal.
- If an email or note is ambiguous, describe it neutrally instead of escalating it.
- Use exact names, titles, and times from the context when available.
- If the context is missing something, say so plainly instead of guessing.

1. FULL BRIEF (400-700 words):
- Start with a one-line executive summary of the day
- List top 3 priorities for immediate attention
- Provide meeting prep (2-4 bullet points per meeting with key talking points)
- Highlight overdue items requiring urgent action
- Suggest specific actions to take (emails to send, decisions to make)
- Include one personal/wellness reminder if schedule is packed
- Use clear headings and bullet points
- Be direct, actionable, and specific

2. SMS BRIEF (max 800 characters):
- Start with day summary (busy/light/critical)
- List top 3 priorities
- First meeting time and title
- Number of overdue follow-ups
- One key action item
- Be extremely concise

3. VOICE BRIEF (30-60 seconds when read aloud):
- Natural, conversational tone
- No bullet points or formatting
- Focus on the most critical 2-3 items
- Include first meeting time
- One specific action to take
- Should sound like a human assistant speaking

Style guidelines:
- Be direct and actionable
- No fluff or generic advice
- Prioritize ruthlessly
- Include specific names and times
- Suggest concrete next steps
- Sound like a sharp, trusted advisor
- Avoid claims that go beyond the evidence in the source context

Output format as JSON with the following structure:
{
  "fullBrief": "markdown formatted full brief",
  "smsBrief": "plain text SMS brief",
  "voiceBrief": "natural spoken brief",
  "topPriorities": ["priority 1", "priority 2", "priority 3"]
}`;

export const MEETING_PREP_PROMPT = `Generate 2-4 bullet points of prep context for this meeting:

Meeting: {title}
Time: {time}
Duration: {duration}
Attendees: {attendees}
Location: {location}
Description: {description}

Previous context with attendees:
{previousContext}

Generate specific, actionable prep points such as:
- Key questions to ask
- Decisions to push for
- Information to share
- Topics to avoid or handle carefully

Be specific and reference actual names/topics when possible.`;

export const EMAIL_ACTION_PROMPT = `Analyze this email and suggest a specific action:

From: {from}
Subject: {subject}
Snippet: {snippet}
Date: {date}
Important: {isImportant}

Suggest ONE specific action in 20 words or less. Examples:
- "Reply with project timeline by EOD"
- "Schedule 30min call this week to discuss"
- "Forward to Sarah for technical review"
- "Archive - no action needed"`;

export const formatMeetingsForPrompt = (meetings: any[]): string => {
  if (meetings.length === 0) return 'No meetings scheduled today.';
  
  return meetings.map(m => 
    `- ${m.title} at ${m.startTime} (${m.duration}) with ${m.attendees.join(', ')}`
  ).join('\n');
};

export const formatTasksForPrompt = (tasks: any[]): string => {
  if (tasks.length === 0) return 'No pending tasks.';
  
  return tasks.map(t => {
    const overdue = t.dueDate && new Date(t.dueDate) < new Date() ? ' [OVERDUE]' : '';
    return `- [${t.priority.toUpperCase()}] ${t.title}${overdue}`;
  }).join('\n');
};

export const formatFollowUpsForPrompt = (followUps: any[]): string => {
  if (followUps.length === 0) return 'No follow-ups required.';
  
  return followUps.map(f => {
    const person = f.person?.name || 'Unknown';
    const overdue = new Date(f.dueDate) < new Date() ? ' [OVERDUE]' : '';
    return `- ${person}: ${f.subject}${overdue}`;
  }).join('\n');
};

export const formatEmailsForPrompt = (emails: any[]): string => {
  if (emails.length === 0) return 'No important emails.';
  
  return emails.map(e => 
    `- From ${e.from}: "${e.subject}" (${e.isUnread ? 'Unread' : 'Read'})`
  ).join('\n');
};

export const formatSystemPrioritiesForPrompt = (topPriorities: string[]): string => {
  if (topPriorities.length === 0) {
    return 'No strong system-scored priorities were identified.';
  }

  return topPriorities.map((priority, index) => `${index + 1}. ${priority}`).join('\n');
};
