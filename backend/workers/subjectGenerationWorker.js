require("dotenv").config();
const {
  saveSubjectsForUser,
} = require("../services/v2/subjectService");
const { Worker } = require("bullmq");
const Redis = require("ioredis");

const pool = require("../config/db");
const openai = require("../config/openai");

const connection = new Redis(
  process.env.REDIS_URL,
  {
    maxRetriesPerRequest: null,
  }
);

const redis = new Redis(
  process.env.REDIS_URL
);


// =====================================================
// WORKER
// =====================================================

new Worker(
  "subject-generation",

  async (job) => {
    const {
      userId,
      context,
      contextHash,
    } = job.data;

    console.log("\n");
    console.log("==================================================");
    console.log("🚀 SUBJECT GENERATION JOB STARTED");
    console.log("==================================================");

    console.log("🆔 Job ID:", job.id);
    console.log("👤 User ID:", userId);
    console.log("📚 Standard/Course:", context.standardOrCourse);
    console.log("🎯 Goal:", context.goalName);
    console.log("📝 Predefined Goal Description:", context.goalDescription);
    console.log(
      "📝 User Goal Description:",
      context.userGoalDescription || "None"
    );
    console.log(
      "🏷️ Goal Metadata:",
      JSON.stringify(context.goalMetadata, null, 2)
    );
    console.log("🔑 Context Hash:", contextHash);

    try {

      // ==========================================
      // STEP 1 - REDIS CACHE
      // ==========================================

      const redisKey =
        `subjects:context:${contextHash}`;

      console.log("\n🔍 STEP 1: Checking Redis cache...");
      console.log("🔑 Redis Key:", redisKey);

      const cached =
        await redis.get(redisKey);

      if (cached) {

        console.log("⚡ REDIS CACHE HIT");

        const subjects =
          JSON.parse(cached);

        console.log(
          `📚 Cached subjects found: ${subjects.length}`
        );

        console.log(
          "📋 Subjects:",
          subjects.map(s => s.name)
        );

        await saveSubjectsForUser({
          userId,
          subjects,
          contextHash,
        });

        console.log(
          "✅ Cached subjects assigned to user"
        );

        console.log("==================================================");
        console.log("🏁 SUBJECT GENERATION COMPLETED FROM REDIS");
        console.log("==================================================\n");

        return subjects;
      }

      console.log("❌ Redis cache MISS");


      // ==========================================
      // STEP 2 - DATABASE CACHE
      // ==========================================

      console.log(
        "\n🔍 STEP 2: Checking PostgreSQL subject cache..."
      );

      const dbCache =
        await pool.query(
          `
          SELECT subjects
          FROM public.subject_generation_cache
          WHERE context_hash = $1
          LIMIT 1
          `,
          [contextHash]
        );

      if (dbCache.rows.length) {

        console.log("💾 DATABASE CACHE HIT");

        const subjects =
          dbCache.rows[0].subjects;

        console.log(
          `📚 Cached subjects found: ${subjects.length}`
        );

        console.log(
          "📋 Subjects:",
          subjects.map(s => s.name)
        );

        await redis.set(
          redisKey,
          JSON.stringify(subjects)
        );

        console.log(
          "⚡ Database result stored in Redis"
        );

        await saveSubjectsForUser({
          userId,
          subjects,
          contextHash,
        });

        console.log(
          "✅ Cached subjects assigned to user"
        );

        console.log("==================================================");
        console.log("🏁 SUBJECT GENERATION COMPLETED FROM DATABASE");
        console.log("==================================================\n");

        return subjects;
      }

      console.log("❌ Database cache MISS");


      // ==========================================
      // STEP 3 - OPENAI
      // ==========================================

      console.log(
        "\n🧠 STEP 3: Calling OpenAI..."
      );

      console.log(
        "🤖 Model: gpt-4o-mini"
      );

      console.log(
        "📨 Sending generation context to AI..."
      );

      const response =
        await openai.chat.completions.create({
          model: "gpt-4o-mini",

          temperature: 0.2,

          response_format: {
            type: "json_object",
          },

          messages: [
            {
              role: "system",

              content: `
You are an expert academic curriculum designer.

Generate a list of academic subjects for a student.

STUDENT STANDARD / COURSE:
${context.standardOrCourse}

SELECTED GOAL:
${context.goalName}

PREDEFINED GOAL DESCRIPTION:
${context.goalDescription}

GOAL METADATA:
${JSON.stringify(context.goalMetadata)}

STUDENT'S CUSTOM GOAL DESCRIPTION:
${context.userGoalDescription}

STRICT RULES:

1. Subjects MUST be appropriate for the student's
   standard/course.

2. Subjects MUST be directly related to the selected
   goal.

3. Consider the student's custom goal description
   when it is provided.

4. Generate a MAXIMUM of 20 subjects.

5. Generate fewer than 20 if fewer subjects are
   genuinely relevant.

6. Do NOT generate chapters.

7. Do NOT generate individual topics.

8. Do NOT generate lessons.

9. Do NOT generate study tasks.

10. Do NOT generate duplicate subjects.

11. Do NOT generate unrelated subjects.

12. Use standard academic subject names.

13. Return JSON only.

FORMAT:

{
  "subjects": [
    {
      "name": "Physics",
      "description": "..."
    }
  ]
}
`,
            },
          ],
        });

      console.log(
        "✅ OpenAI response received"
      );

      console.log(
        "📊 Token usage:",
        response.usage || "Not available"
      );


      // ==========================================
      // STEP 4 - RAW AI RESPONSE
      // ==========================================

      const rawContent =
        response
          .choices[0]
          .message
          .content;

      console.log(
        "\n🤖 RAW AI RESPONSE:"
      );

      console.log(
        rawContent
      );


      // ==========================================
      // STEP 5 - PARSE RESPONSE
      // ==========================================

      let parsed;

      try {

        parsed =
          JSON.parse(rawContent);

        console.log(
          "\n✅ AI JSON parsed successfully"
        );

      } catch (error) {

        console.error(
          "❌ AI returned invalid JSON"
        );

        console.error(
          "Raw response:",
          rawContent
        );

        throw new Error(
          "AI returned invalid subject JSON"
        );
      }


      let subjects =
        Array.isArray(parsed.subjects)
          ? parsed.subjects
          : [];

      console.log(
        `📚 AI generated ${subjects.length} subjects before validation`
      );


      // ==========================================
      // STEP 6 - VALIDATION
      // ==========================================

      subjects =
        subjects
          .filter(
            (subject) =>
              subject &&
              typeof subject.name === "string" &&
              subject.name.trim()
          )
          .slice(0, 20);

      const seen = new Set();

      subjects =
        subjects.filter((subject) => {

          const normalizedName =
            subject.name
              .trim()
              .toLowerCase();

          if (seen.has(normalizedName)) {
            console.log(
              "⚠️ Duplicate removed:",
              subject.name
            );

            return false;
          }

          seen.add(normalizedName);

          return true;
        });


      if (!subjects.length) {

        console.error(
          "❌ No valid subjects generated"
        );

        throw new Error(
          "AI generated no valid subjects"
        );
      }


      console.log(
        `\n✅ ${subjects.length} valid subjects after validation`
      );

      console.log(
        "📋 FINAL SUBJECTS:"
      );

      subjects.forEach(
        (subject, index) => {
          console.log(
            `${index + 1}. ${subject.name}`
          );
        }
      );


      // ==========================================
      // STEP 7 - SAVE DATABASE CACHE
      // ==========================================

      console.log(
        "\n💾 STEP 7: Saving subject generation cache..."
      );

      await pool.query(
        `
        INSERT INTO public.subject_generation_cache
        (
          context_hash,
          standard_or_course,
          goal_id,
          goal_name,
          goal_description,
          user_goal_description,
          goal_metadata,
          subjects,
          model
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9
        )

        ON CONFLICT (context_hash)
        DO UPDATE SET
          subjects = EXCLUDED.subjects,
          updated_at = NOW()
        `,
        [
          contextHash,
          context.standardOrCourse,
          context.goalId,
          context.goalName,
          context.goalDescription,
          context.userGoalDescription,
          JSON.stringify(context.goalMetadata),
          JSON.stringify(subjects),
          "gpt-4o-mini",
        ]
      );

      console.log(
        "✅ Subject generation cache saved"
      );


      // ==========================================
      // STEP 8 - REDIS CACHE
      // ==========================================

      console.log(
        "\n⚡ STEP 8: Saving subjects to Redis..."
      );

      await redis.set(
        redisKey,
        JSON.stringify(subjects)
      );

      console.log(
        "✅ Subjects cached in Redis"
      );


      // ==========================================
      // STEP 9 - SAVE USER SUBJECTS
      // ==========================================

      console.log(
        "\n💾 STEP 9: Assigning subjects to user..."
      );

      await saveSubjectsForUser({
        userId,
        subjects,
        contextHash,
      });

      console.log(
        "✅ Subjects assigned to user"
      );


      // ==========================================
      // FINAL
      // ==========================================

      console.log("\n");
      console.log("==================================================");
      console.log("🎉 SUBJECT GENERATION SUCCESSFUL");
      console.log("==================================================");
      console.log(
        `👤 User: ${userId}`
      );
      console.log(
        `📚 Total Subjects: ${subjects.length}`
      );
      console.log(
        `🔑 Context Hash: ${contextHash}`
      );
      console.log(
        "🧠 Source: OpenAI"
      );
      console.log(
        "💾 Saved: PostgreSQL + Redis"
      );
      console.log(
        "🎓 Onboarding: Completed"
      );
      console.log("==================================================\n");

      return subjects;

    } catch (error) {

      console.error("\n");
      console.error("==================================================");
      console.error("❌ SUBJECT GENERATION FAILED");
      console.error("==================================================");
      console.error("👤 User:", userId);
      console.error("❌ Error:", error.message);
      console.error("==================================================\n");

      throw error;
    }
  },

  {
    connection,
  }
);