const onboardingService = require("../../services/v2/onboardingService");
const subjectService = require("../../services/v2/subjectService");
exports.savePersonalInformation = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      mobileNumber,
    } = req.body;

    // Required fields
    if (
      !firstName ||
      !lastName ||
      !email ||
      !password ||
      !confirmPassword ||
      !mobileNumber
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Confirm password
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    // Basic password validation
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const result =
      await onboardingService.savePersonalInformation({
        userId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        mobileNumber: mobileNumber.trim(),
      });

    return res.status(200).json({
      success: true,
      message: "Personal information saved successfully",

      currentStep: 2,

      user: result.user,

      onboarding: {
        currentStep: result.onboarding.current_step,
        personalInfoCompleted:
          result.onboarding.personal_info_completed,
        academicInfoCompleted:
          result.onboarding.academic_info_completed,
        goalsCompleted:
          result.onboarding.goals_completed,
        subjectsCompleted:
          result.onboarding.subjects_completed,
      },
    });
  } catch (error) {
    console.error(
      "SAVE PERSONAL INFORMATION ERROR:",
      error
    );

    if (error.message === "EMAIL_ALREADY_EXISTS") {
      return res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
    }

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to save personal information",
    });
  }
};

exports.saveAcademicInformation = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      schoolName,
      courseOrStandard,
      district,
      state,
      pincode,
    } = req.body;

    if (
      !schoolName ||
      !courseOrStandard ||
      !district ||
      !state ||
      !pincode
    ) {
      return res.status(400).json({
        success: false,
        message: "All academic fields are required",
      });
    }

    const result =
      await onboardingService.saveAcademicInformation({
        userId,
        schoolName: schoolName.trim(),
        courseOrStandard: courseOrStandard.trim(),
        district: district.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
      });

    return res.status(200).json({
      success: true,
      message: "Academic information saved successfully",
      currentStep: 3,
      academic: result.academic,
      onboarding: {
        currentStep: result.onboarding.current_step,
        personalInfoCompleted:
          result.onboarding.personal_info_completed,
        academicInfoCompleted:
          result.onboarding.academic_info_completed,
        goalsCompleted:
          result.onboarding.goals_completed,
        subjectsCompleted:
          result.onboarding.subjects_completed,
      },
    });
  } catch (error) {
    console.error(
      "SAVE ACADEMIC INFORMATION ERROR:",
      error
    );

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to save academic information",
    });
  }
};

exports.getGoals = async (req, res) => {
  try {
    const goals = await onboardingService.getGoals();

    return res.status(200).json({
      success: true,
      goals,
    });

  } catch (error) {

    console.error("GET GOALS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch goals",
    });
  }
};

exports.saveGoal = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      goalId,
      goalDescription,
    } = req.body;

    const result =
      await onboardingService.saveGoal({
        userId,
        goalId,
        goalDescription,
      });

   
    return res.status(200).json({
  success: true,

  message: "Goal saved successfully",

  currentStep: 4,

  goal: result.goal,

  subjectGeneration: {
    status:
      result.subjectGeneration.status,

    contextHash:
      result.subjectGeneration.contextHash,
  },

  onboarding: {
    currentStep:
      result.onboarding.current_step,

    personalInfoCompleted:
      result.onboarding.personal_info_completed,

    academicInfoCompleted:
      result.onboarding.academic_info_completed,

    goalsCompleted:
      result.onboarding.goals_completed,

    subjectsCompleted:
      result.onboarding.subjects_completed,
  },
});

  } catch (error) {

    console.error("SAVE GOAL ERROR:", error);

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (error.message === "INVALID_GOAL") {
      return res.status(400).json({
        success: false,
        message: "Invalid goal selected",
      });
    }

    if (error.message === "GOAL_REQUIRED") {
      return res.status(400).json({
        success: false,
        message:
          "Select a goal or describe your goal",
      });
    }

    if (
      error.message ===
      "GOAL_DESCRIPTION_TOO_LONG"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Goal description cannot exceed 30 words",
      });
    }

    if (
      error.message ===
      "ONBOARDING_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "Onboarding record not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to save goal",
    });
  }
};

exports.getSubjects = async (req, res) => {
  try {

    const userId =
      req.user.id;

    const result =
      await subjectService.getSubjectGenerationStatus({
        userId,
      });

    return res.status(200).json({
      success: true,

      status:
        result.status,

      currentStep:
        result.currentStep,

      subjectsCompleted:
        result.subjectsCompleted,

      subjects:
        result.subjects,
    });

  } catch (error) {

    console.error(
      "GET SUBJECTS ERROR:",
      error
    );

    if (
      error.message ===
      "ONBOARDING_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Onboarding record not found",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch subjects",
    });
  }
};

exports.selectSubjects = async (req, res) => {
  try {
    const userId = req.user.id;

    const { subjectIds } = req.body;

    const result = await subjectService.selectUserSubjects({
      userId,
      subjectIds,
    });

    return res.status(200).json({
      success: true,
      message: "Subjects selected successfully",
      selectedSubjects: result.selectedSubjects,
      count: result.count,
      isOnboarded: true,
    });

  } catch (error) {

    console.error(
      "SELECT SUBJECTS ERROR:",
      error
    );

    if (error.message === "SUBJECTS_REQUIRED") {
      return res.status(400).json({
        success: false,
        message: "Please select at least one subject",
      });
    }

    if (
      error.message ===
      "INVALID_SUBJECT_SELECTION"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "One or more selected subjects are invalid",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to select subjects",
    });
  }
};