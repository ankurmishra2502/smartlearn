const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate AI Quiz
 */
exports.generateQuiz = async ({
  title,
  description,
  transcript,
  easy,
  medium,
  hard,
}) => {
  const prompt = `
You are an expert teacher and educational content creator.

Generate multiple-choice questions ONLY from the provided content.

==========================
TOPIC
==========================

${title}

==========================
TEACHER DESCRIPTION
==========================

${description}



==========================
QUESTION REQUIREMENTS
==========================

Generate exactly:

Easy Questions: ${easy}
Medium Questions: ${medium}
Hard Questions: ${hard}

==========================
DIFFICULTY RULES
==========================

Easy
- Recall
- Definitions
- Simple facts

Medium
- Understanding
- Comparison
- Application

Hard
- Scenario based
- Analytical
- Critical thinking

==========================
LANGUAGE
==========================

Generate EVERY question in BOTH languages.

English

Hindi

For technical words use

Example

Photosynthesis (प्रकाश संश्लेषण)

Respiration (श्वसन)

Chlorophyll (क्लोरोफिल)

==========================
RULES
==========================

1. Don't create duplicate questions.

2. Don't use outside knowledge.

3. Questions must come only from topic and description.

4. Every question must have exactly 4 options.

5. Only one option should be correct.

6. Correct answer should be option index (0-3).

7. Return ONLY valid JSON.

==========================
JSON FORMAT
==========================

{
  "easy":[
    {
      "question_en":"",
      "question_hi":"",
      "options":[
        {
          "en":"",
          "hi":"",
          "is_correct":false
        },
        {
          "en":"",
          "hi":"",
          "is_correct":true
        },
        {
          "en":"",
          "hi":"",
          "is_correct":false
        },
        {
          "en":"",
          "hi":"",
          "is_correct":false
        }
      ]
    }
  ],
  "medium":[],
  "hard":[]
}

Return ONLY valid JSON.
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",

    temperature: 0.3,

    response_format: {
      type: "json_object",
    },

    messages: [
      {
        role: "system",
        content: prompt,
      },
    ],
  });

  return JSON.parse(completion.choices[0].message.content);
};