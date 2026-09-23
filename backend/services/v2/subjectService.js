const crypto = require("crypto");
const Redis = require("ioredis");
const subjectQueue = require("../../queues/subjectQueue");
const pool = require("../../config/db");

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const createContextHash = (context) => {
  const normalized = {
    standardOrCourse: context.standardOrCourse || "",
    goalId: context.goalId || null,
    goalName: context.goalName || "",
    goalDescription: context.goalDescription || "",
    userGoalDescription: context.userGoalDescription || "",
    goalMetadata: context.goalMetadata || null,
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
};


// =====================================================
// GET USER SUBJECT CONTEXT
// =====================================================

const getUserSubjectContext = async (userId) => {
  const result = await pool.query(
    `
    SELECT
      u.id AS user_id,
      uad.class,
      uad.course_or_standard,

      ug.goal_id,
      ug.goal_description AS user_goal_description,

      g.name AS goal_name,
      g.description AS predefined_goal_description,
      g.metadata AS goal_metadata

    FROM public.users u

    LEFT JOIN public.user_academic_details uad
      ON uad.user_id = u.id

    LEFT JOIN public.user_goals ug
      ON ug.user_id = u.id
      AND ug.is_primary = TRUE

    LEFT JOIN public.goals g
      ON g.id = ug.goal_id

    WHERE u.id = $1

    LIMIT 1
    `,
    [userId]
  );

  if (!result.rows.length) {
    throw new Error("USER_NOT_FOUND");
  }

  const row = result.rows[0];

  const standardOrCourse =
    row.course_or_standard ||
    row.class ||
    "";

  if (!standardOrCourse) {
    throw new Error("ACADEMIC_INFO_NOT_FOUND");
  }

  if (!row.goal_id && !row.user_goal_description) {
    throw new Error("GOAL_NOT_FOUND");
  }

  return {
    userId,

    standardOrCourse,

    goalId: row.goal_id || null,

    goalName:
      row.goal_name ||
      "Custom Goal",

    goalDescription:
      row.predefined_goal_description ||
      "",

    userGoalDescription:
      row.user_goal_description ||
      "",

    goalMetadata:
      row.goal_metadata ||
      null,
  };
};


// =====================================================
// QUEUE SUBJECT GENERATION
// =====================================================

const queueSubjectGeneration = async ({ userId }) => {

  // Get complete context first
  const context = await getUserSubjectContext(userId);

  // Generate deterministic hash
  const contextHash = createContextHash(context);

  console.log("\n==============================================");
  console.log("SUBJECT GENERATION QUEUE");
  console.log("==============================================");
  console.log("User ID:", userId);
  console.log("Standard/Course:", context.standardOrCourse);
  console.log("Goal ID:", context.goalId);
  console.log("Goal Name:", context.goalName);
  console.log("Goal Description:", context.goalDescription);
  console.log("User Goal Description:", context.userGoalDescription);
  console.log("Context Hash:", contextHash);
  console.log("==============================================\n");

  const jobId = `subject-${userId}-${contextHash}`;

  const existingJob = await subjectQueue.getJob(jobId);

  if (existingJob) {

    const state = await existingJob.getState();

    console.log(
      `[SUBJECT QUEUE] Existing job found: ${jobId}, state=${state}`
    );

    if (
      state === "waiting" ||
      state === "active" ||
      state === "delayed"
    ) {
      return {
        status: "processing",
        contextHash,
      };
    }

    if (state === "completed") {
      return {
        status: "completed",
        contextHash,
      };
    }
  }

  const job = await subjectQueue.add(
    "generate-subjects",
    {
      userId,
      context,
      contextHash,
    },
    {
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  console.log(
    `[SUBJECT QUEUE] Job queued successfully: ${job.id}`
  );

  return {
    status: "processing",
    contextHash,
    jobId: job.id,
  };
};


// =====================================================
// GET USER SUBJECTS
// =====================================================

const getUserSubjects = async (userId) => {
  const result = await pool.query(
    `
    SELECT
      uas.id,
      uas.ai_subject_id,
      s.name,
      s.description,
      uas.source,
      uas.display_order,
      uas.created_at

    FROM public.user_ai_subjects uas

    JOIN public.ai_subjects s
      ON s.id = uas.ai_subject_id

    WHERE uas.user_id = $1
      AND uas.is_active = TRUE

    ORDER BY uas.display_order ASC
    `,
    [userId]
  );

  return result.rows;
};


// =====================================================
// GET SUBJECT GENERATION STATUS
// =====================================================

const getSubjectGenerationStatus = async ({ userId }) => {

  const onboardingResult = await pool.query(
    `
    SELECT
      current_step,
      subjects_completed
    FROM public.user_onboarding
    WHERE user_id = $1
    `,
    [userId]
  );

  if (!onboardingResult.rows.length) {
    throw new Error("ONBOARDING_NOT_FOUND");
  }

  const onboarding = onboardingResult.rows[0];

  const subjects = await getUserSubjects(userId);

  return {
    status: onboarding.subjects_completed
      ? "completed"
      : "processing",

    currentStep: onboarding.current_step,

    subjectsCompleted: onboarding.subjects_completed,

    subjects,
  };
};

const saveSubjectsForUser = async ({
  userId,
  subjects,
  contextHash,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("[SUBJECT SAVE] Starting database transaction");
    console.log("[SUBJECT SAVE] User:", userId);
    console.log("[SUBJECT SAVE] Subjects:", subjects.length);

    // Remove previous AI subjects for this user
    await client.query(
      `
      DELETE FROM public.user_ai_subjects
      WHERE user_id = $1
      `,
      [userId]
    );

    for (let index = 0; index < subjects.length; index++) {
      const subject = subjects[index];

      const name = subject.name.trim();

      const normalizedName = name
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      // Create subject if it doesn't already exist
      const subjectResult = await client.query(
        `
        INSERT INTO public.ai_subjects
          (
            name,
            normalized_name,
            description
          )
        VALUES
          ($1, $2, $3)
        ON CONFLICT (normalized_name)
        DO UPDATE SET
          description = COALESCE(
            EXCLUDED.description,
            public.ai_subjects.description
          ),
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
        `,
        [
          name,
          normalizedName,
          subject.description || null,
        ]
      );

      const aiSubjectId = subjectResult.rows[0].id;

      await client.query(
        `
        INSERT INTO public.user_ai_subjects
          (
            user_id,
            ai_subject_id,
            source,
            generation_context_hash,
            display_order,
            is_active
          )
        VALUES
          ($1, $2, 'ai', $3, $4, TRUE)
        ON CONFLICT (user_id, ai_subject_id)
        DO UPDATE SET
          source = 'ai',
          generation_context_hash = EXCLUDED.generation_context_hash,
          display_order = EXCLUDED.display_order,
          is_active = TRUE,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          userId,
          aiSubjectId,
          contextHash,
          index + 1,
        ]
      );
    }

    // Mark onboarding as completed
    await client.query(
      `
      UPDATE public.user_onboarding
      SET
        subjects_completed = TRUE,
        current_step = 4,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      `,
      [userId]
    );

    // Mark user as fully onboarded
    await client.query(
      `
      UPDATE public.users
      SET
        is_onboarded = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [userId]
    );

    await client.query("COMMIT");

    console.log("[SUBJECT SAVE] Database transaction committed");
    console.log("[SUBJECT SAVE] User marked as onboarded");

    return {
      success: true,
      subjectsCount: subjects.length,
    };

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("[SUBJECT SAVE] ERROR:", error);

    throw error;

  } finally {
    client.release();
  }
};


// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  createContextHash,
  getUserSubjectContext,
  queueSubjectGeneration,
  getUserSubjects,
  getSubjectGenerationStatus,
    saveSubjectsForUser,
};