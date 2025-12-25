export interface StarterPrompt {
  id: string;
  text: string;
  description?: string;
}

export function getDocumentStarterPrompts(documentTitle?: string): StarterPrompt[] {
  const title = documentTitle || "this document";
  
  return [
    {
      id: "summary",
      text: `Summarize the key points from ${title}`,
      description: "Get a concise overview of the main content"
    },
    {
      id: "questions",
      text: `What are the most important questions I should ask about ${title}?`,
      description: "Generate relevant questions to deepen understanding"
    },
    {
      id: "insights",
      text: `What are the main insights or takeaways from ${title}?`,
      description: "Extract key learnings and conclusions"
    },
    {
      id: "connections",
      text: `How does the content in ${title} relate to other topics I've studied?`,
      description: "Find connections and relationships with other knowledge"
    },
    {
      id: "application",
      text: `How can I apply the concepts from ${title} in practice?`,
      description: "Get practical applications and implementation ideas"
    },
    {
      id: "critique",
      text: `What are potential limitations or criticisms of the content in ${title}?`,
      description: "Explore critical perspectives and counterarguments"
    }
  ];
}

export function getEntityStarterPrompts(entityName?: string, entityType?: string): StarterPrompt[] {
  const name = entityName || "this entity";
  const type = entityType || "concept";
  
  const basePrompts = [
    {
      id: "explain",
      text: `Explain ${name} in simple terms`,
      description: "Get a clear, easy-to-understand explanation"
    },
    {
      id: "details",
      text: `Tell me more about ${name} and its characteristics`,
      description: "Explore detailed information and properties"
    },
    {
      id: "relationships",
      text: `What is ${name} related to and how does it connect to other concepts?`,
      description: "Understand relationships and connections"
    },
    {
      id: "evolution",
      text: `How has ${name} evolved or changed over time?`,
      description: "Learn about historical development and changes"
    }
  ];

  const typeSpecificPrompts = {
    person: [
      {
        id: "biography",
        text: `What are the key achievements and contributions of ${name}?`,
        description: "Learn about their impact and work"
      },
      {
        id: "context",
        text: `What was the historical context for ${name}'s work?`,
        description: "Understand the time period and influences"
      }
    ],
    technology: [
      {
        id: "how-it-works",
        text: `How does ${name} work technically?`,
        description: "Get technical details and implementation"
      },
      {
        id: "use-cases",
        text: `What are the best use cases for ${name}?`,
        description: "Learn when and how to use it"
      }
    ],
    concept: [
      {
        id: "examples",
        text: `Can you give me real-world examples of ${name}?`,
        description: "Understand through practical examples"
      },
      {
        id: "misconceptions",
        text: `What are common misconceptions about ${name}?`,
        description: "Clear up confusion and misunderstandings"
      }
    ],
    organization: [
      {
        id: "mission",
        text: `What is the mission and impact of ${name}?`,
        description: "Learn about their purpose and influence"
      },
      {
        id: "history",
        text: `How did ${name} evolve over time?`,
        description: "Understand their development and growth"
      }
    ]
  };

  const additionalPrompts = typeSpecificPrompts[type as keyof typeof typeSpecificPrompts] || typeSpecificPrompts.concept;
  
  return [...basePrompts, ...additionalPrompts];
}
