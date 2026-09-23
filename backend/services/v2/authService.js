const axios = require("axios");
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");
const bcrypt = require("bcrypt");
const googleLogin = async (token) => {
  if (!token) {
    throw new Error("Token is required");
  }

  // Same Google authentication flow as V1
  const googleResponse = await axios.get(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const payload = googleResponse.data;

  const {
    email,
    name,
    picture,
    sub,
    given_name,
    family_name,
    email_verified,
  } = payload;

  if (!email) {
    throw new Error("Google email not found");
  }

  const firstName =
    given_name ||
    name?.split(" ")[0] ||
    "";

  const lastName =
    family_name ||
    name?.split(" ").slice(1).join(" ") ||
    "";

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let user;
    let isNewUser = false;

    // ------------------------------------------------
    // 1. Check Google provider
    // ------------------------------------------------

    const providerResult = await client.query(
      `
      SELECT *
      FROM public.auth_providers
      WHERE provider = 'google'
        AND provider_user_id = $1
      LIMIT 1
      `,
      [sub]
    );

    if (providerResult.rows.length > 0) {
      // Existing Google account

      const provider = providerResult.rows[0];

      const userResult = await client.query(
        `
        SELECT *
        FROM public.users
        WHERE id = $1
        LIMIT 1
        `,
        [provider.user_id]
      );

      if (!userResult.rows.length) {
        throw new Error("User not found");
      }

      user = userResult.rows[0];

      await client.query(
        `
        UPDATE public.users
        SET
          profile_picture = $2,
          email_verified = $3,
          last_login = NOW(),
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          user.id,
          picture || null,
          email_verified === true,
        ]
      );

      await client.query(
        `
        UPDATE public.auth_providers
        SET
          provider_email = $2,
          provider_name = $3,
          provider_first_name = $4,
          provider_last_name = $5,
          profile_image_url = $6,
          provider_metadata = $7,
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          provider.id,
          email,
          name || null,
          firstName,
          lastName,
          picture || null,
          payload,
        ]
      );
    } else {
      // ------------------------------------------------
      // 2. Check existing user by email
      // ------------------------------------------------

      const existingUserResult = await client.query(
        `
        SELECT *
        FROM public.users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [email]
      );

      if (existingUserResult.rows.length > 0) {
        // Existing account
        // Link Google to it

        user = existingUserResult.rows[0];

        await client.query(
          `
          UPDATE public.users
          SET
            google_id = COALESCE(google_id, $2),
            profile_picture =
              COALESCE($3, profile_picture),
            email_verified = $4,
            last_login = NOW(),
            updated_at = NOW()
          WHERE id = $1
          `,
          [
            user.id,
            sub,
            picture || null,
            email_verified === true,
          ]
        );

        await client.query(
          `
          INSERT INTO public.auth_providers
          (
            user_id,
            provider,
            provider_user_id,
            provider_email,
            provider_name,
            provider_first_name,
            provider_last_name,
            profile_image_url,
            provider_metadata
          )
          VALUES
          (
            $1, 'google', $2, $3, $4,
            $5, $6, $7, $8
          )
          `,
          [
            user.id,
            sub,
            email,
            name || null,
            firstName,
            lastName,
            picture || null,
            payload,
          ]
        );
      } else {
        // ------------------------------------------------
        // 3. New user
        // ------------------------------------------------

        const newUserResult = await client.query(
          `
          INSERT INTO public.users
          (
            email,
            first_name,
            last_name,
            google_id,
            profile_picture,
            email_verified,
            auth_provider,
            is_onboarded,
            last_login
          )
          VALUES
          (
            $1, $2, $3, $4, $5,
            $6, 'google', false, NOW()
          )
          RETURNING *
          `,
          [
            email,
            firstName,
            lastName,
            sub,
            picture || null,
            email_verified === true,
          ]
        );

        user = newUserResult.rows[0];

        isNewUser = true;

        await client.query(
          `
          INSERT INTO public.auth_providers
          (
            user_id,
            provider,
            provider_user_id,
            provider_email,
            provider_name,
            provider_first_name,
            provider_last_name,
            profile_image_url,
            provider_metadata
          )
          VALUES
          (
            $1, 'google', $2, $3, $4,
            $5, $6, $7, $8
          )
          `,
          [
            user.id,
            sub,
            email,
            name || null,
            firstName,
            lastName,
            picture || null,
            payload,
          ]
        );
      }
    }

    // ------------------------------------------------
    // 4. Onboarding
    // ------------------------------------------------

    let onboardingResult = await client.query(
      `
      SELECT *
      FROM public.user_onboarding
      WHERE user_id = $1
      `,
      [user.id]
    );

    let onboarding;

    if (onboardingResult.rows.length === 0) {
      const result = await client.query(
        `
        INSERT INTO public.user_onboarding
        (
          user_id,
          current_step
        )
        VALUES ($1, 1)
        RETURNING *
        `,
        [user.id]
      );

      onboarding = result.rows[0];
    } else {
      onboarding = onboardingResult.rows[0];
    }

    await client.query("COMMIT");

    // ------------------------------------------------
    // 5. JWT
    // ------------------------------------------------

    const jwtToken = jwt.sign(
      {
        id: user.id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    return {
      token: jwtToken,

      isNewUser,

      isOnboarded: user.is_onboarded === true,

      currentStep:
        user.is_onboarded === true
          ? null
          : onboarding.current_step,

      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        profilePicture: user.profile_picture,
        isOnboarded: user.is_onboarded,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const emailLogin = async (email, password) => {
  const result = await pool.query(
    `
    SELECT *
    FROM public.users
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1
    `,
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const user = result.rows[0];

  // User doesn't have a password
  if (!user.password_hash) {
    throw new Error("PASSWORD_NOT_SET");
  }

  const isPasswordValid = await bcrypt.compare(
    password,
    user.password_hash
  );

  if (!isPasswordValid) {
    throw new Error("INVALID_CREDENTIALS");
  }

  // Update last login
  await pool.query(
    `
    UPDATE public.users
    SET last_login = NOW(),
        updated_at = NOW()
    WHERE id = $1
    `,
    [user.id]
  );

  // Get onboarding status
  const onboardingResult = await pool.query(
    `
    SELECT *
    FROM public.user_onboarding
    WHERE user_id = $1
    `,
    [user.id]
  );

  const onboarding =
    onboardingResult.rows[0] || null;

  // Generate JWT
  const token = jwt.sign(
    {
      id: user.id,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );

  return {
    token,

    isNewUser: false,

    isOnboarded: user.is_onboarded === true,

    currentStep:
      user.is_onboarded === true
        ? null
        : onboarding?.current_step || 1,

    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      profilePicture: user.profile_picture,
      isOnboarded: user.is_onboarded,
    },
  };
};



module.exports = {
  googleLogin,
    emailLogin,
};


