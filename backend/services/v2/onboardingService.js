const bcrypt = require("bcrypt");
const pool = require("../../config/db");
const subjectService = require("./subjectService");
exports.savePersonalInformation = async ({
  userId,
  firstName,
  lastName,
  email,
  password,
  mobileNumber,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check whether email is already used by another user
    const emailCheck = await client.query(
      `
      SELECT id
      FROM public.users
      WHERE LOWER(email) = LOWER($1)
        AND id <> $2
      LIMIT 1
      `,
      [email, userId]
    );

    if (emailCheck.rows.length > 0) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update user
    const userResult = await client.query(
      `
      UPDATE public.users
      SET
        first_name = $2,
        last_name = $3,
        email = $4,
        mobile_number = $5,
        password_hash = $6,
        password_set_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        email,
        first_name,
        last_name,
        mobile_number,
        profile_picture,
        is_onboarded
      `,
      [
        userId,
        firstName,
        lastName,
        email,
        mobileNumber,
        passwordHash,
      ]
    );

    if (userResult.rows.length === 0) {
      throw new Error("USER_NOT_FOUND");
    }

    // Update onboarding progress
    const onboardingResult = await client.query(
      `
      INSERT INTO public.user_onboarding
      (
        user_id,
        current_step,
        personal_info_completed
      )
      VALUES ($1, 2, TRUE)

      ON CONFLICT (user_id)
      DO UPDATE SET
        current_step =
          CASE
            WHEN public.user_onboarding.current_step < 2
            THEN 2
            ELSE public.user_onboarding.current_step
          END,
        personal_info_completed = TRUE,
        updated_at = NOW()

      RETURNING *
      `,
      [userId]
    );

    await client.query("COMMIT");

    return {
      user: userResult.rows[0],
      onboarding: onboardingResult.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

exports.saveAcademicInformation = async ({
  userId,
  schoolName,
  courseOrStandard,
  district,
  state,
  pincode,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
      SELECT id
      FROM public.users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error("USER_NOT_FOUND");
    }

    const academicResult = await client.query(
      `
      INSERT INTO public.user_academic_details
      (
        user_id,
        school_name,
        course_or_standard,
        district,
        state,
        pincode
      )
      VALUES ($1, $2, $3, $4, $5, $6)

      ON CONFLICT (user_id)
      DO UPDATE SET
        school_name = EXCLUDED.school_name,
        course_or_standard = EXCLUDED.course_or_standard,
        district = EXCLUDED.district,
        state = EXCLUDED.state,
        pincode = EXCLUDED.pincode,
        updated_at = NOW()

      RETURNING
        user_id,
        school_name,
        course_or_standard,
        district,
        state,
        pincode
      `,
      [
        userId,
        schoolName,
        courseOrStandard,
        district,
        state,
        pincode,
      ]
    );

    const onboardingResult = await client.query(
      `
      UPDATE public.user_onboarding
      SET
        current_step =
          CASE
            WHEN current_step < 3 THEN 3
            ELSE current_step
          END,
        academic_info_completed = TRUE,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
      `,
      [userId]
    );

    await client.query("COMMIT");

    return {
      academic: academicResult.rows[0],
      onboarding: onboardingResult.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

exports.getGoals = async () => {
  const result = await pool.query(
    `
    SELECT
      id,
      name,
      description,
      metadata,
      display_order
    FROM public.goals
    WHERE is_active = TRUE
    ORDER BY display_order ASC, name ASC
    `
  );

  return result.rows;
};


exports.saveGoal = async ({
  userId,
  goalId,
  goalDescription,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ---------------------------------------------
    // Check user
    // ---------------------------------------------

    const userResult = await client.query(
      `
      SELECT id
      FROM public.users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error("USER_NOT_FOUND");
    }

    // ---------------------------------------------
    // Validate goal selection
    // ---------------------------------------------

    if (goalId) {
      const goalResult = await client.query(
        `
        SELECT
          id,
          name,
          description,
          metadata
        FROM public.goals
        WHERE id = $1
          AND is_active = TRUE
        LIMIT 1
        `,
        [goalId]
      );

      if (goalResult.rows.length === 0) {
        throw new Error("INVALID_GOAL");
      }
    }

    // ---------------------------------------------
    // Validate custom goal
    // ---------------------------------------------

    const cleanedDescription =
      goalDescription?.trim() || null;

    if (!goalId && !cleanedDescription) {
      throw new Error("GOAL_REQUIRED");
    }

    // ---------------------------------------------
    // 100 word validation
    // ---------------------------------------------

    if (cleanedDescription) {
      const wordCount = cleanedDescription
        .split(/\s+/)
        .filter(Boolean)
        .length;

      if (wordCount > 100) {
        throw new Error("GOAL_DESCRIPTION_TOO_LONG");
      }
    }

    // ---------------------------------------------
    // Make existing primary goals non-primary
    // ---------------------------------------------

    await client.query(
      `
      UPDATE public.user_goals
      SET
        is_primary = FALSE,
        updated_at = NOW()
      WHERE user_id = $1
        AND is_primary = TRUE
      `,
      [userId]
    );

    // ---------------------------------------------
    // Save new goal
    // ---------------------------------------------

    const goalResult = await client.query(
      `
      INSERT INTO public.user_goals
      (
        user_id,
        goal_id,
        goal_description,
        is_primary
      )
      VALUES
      (
        $1,
        $2,
        $3,
        TRUE
      )
      RETURNING
        id,
        user_id,
        goal_id,
        goal_description,
        is_primary,
        created_at,
        updated_at
      `,
      [
        userId,
        goalId || null,
        cleanedDescription,
      ]
    );

    // ---------------------------------------------
    // Goal is Step 3 completed.
    // Next screen = Step 4 Subjects.
    // ---------------------------------------------

    const onboardingResult = await client.query(
      `
      UPDATE public.user_onboarding
      SET
        current_step =
          CASE
            WHEN current_step < 4 THEN 4
            ELSE current_step
          END,

        goals_completed = TRUE,

        updated_at = NOW()

      WHERE user_id = $1

      RETURNING *
      `,
      [userId]
    );

    if (onboardingResult.rows.length === 0) {
      throw new Error("ONBOARDING_NOT_FOUND");
    }

    await client.query("COMMIT");
    const subjectGeneration =
  await subjectService.queueSubjectGeneration({
    userId,
  });
    return {
      goal: goalResult.rows[0],
      onboarding: onboardingResult.rows[0],
        subjectGeneration,
    };

  } catch (error) {

    await client.query("ROLLBACK");

    throw error;

  } finally {
  client.release();
}
};

exports.selectUserSubjects = async ({
  userId,
  subjectIds,
}) => {
  const client = await pool.connect();

  try {
    if (!Array.isArray(subjectIds) || subjectIds.length === 0) {
      throw new Error("SUBJECTS_REQUIRED");
    }

    // Remove duplicate IDs
    const uniqueSubjectIds = [...new Set(subjectIds)];

    await client.query("BEGIN");

    /*
     * Make sure every selected subject actually belongs
     * to this user's AI-generated subject list.
     */
    const validationResult = await client.query(
      `
      SELECT
        uas.ai_subject_id,
        s.name,
        s.description,
        uas.display_order

      FROM public.user_ai_subjects uas

      JOIN public.ai_subjects s
        ON s.id = uas.ai_subject_id

      WHERE uas.user_id = $1
        AND uas.is_active = TRUE
        AND uas.ai_subject_id = ANY($2::uuid[])
      `,
      [userId, uniqueSubjectIds]
    );

    if (
      validationResult.rows.length !== uniqueSubjectIds.length
    ) {
      throw new Error("INVALID_SUBJECT_SELECTION");
    }

    /*
     * First unselect all generated subjects
     * for this user.
     */
    await client.query(
      `
      UPDATE public.user_ai_subjects
      SET
        is_selected = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND is_active = TRUE
      `,
      [userId]
    );

    /*
     * Select the subjects chosen by the user.
     */
    await client.query(
      `
      UPDATE public.user_ai_subjects
      SET
        is_selected = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND ai_subject_id = ANY($2::uuid[])
        AND is_active = TRUE
      `,
      [userId, uniqueSubjectIds]
    );

    /*
     * Now onboarding is complete.
     */
    await client.query(
      `
      UPDATE public.user_onboarding
      SET
        subjects_completed = TRUE,
        current_step = 4,
        completed_at = COALESCE(
          completed_at,
          CURRENT_TIMESTAMP
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      `,
      [userId]
    );

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

    console.log(
      `[SUBJECT SELECTION] User ${userId} selected ${uniqueSubjectIds.length} subjects`
    );

    return {
      selectedSubjects: validationResult.rows,
      count: uniqueSubjectIds.length,
    };

  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "[SUBJECT SELECTION ERROR]",
      error
    );

    throw error;

  } finally {
    client.release();
  }
};