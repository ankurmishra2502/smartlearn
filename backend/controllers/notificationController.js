const pool = require("../config/db");

function formatXPLabel(item) {
  const event = item.event_type;

  if (event === "QUIZ_COMPLETED" && item.reference_type) {
    return `Quiz: ${item.reference_type}`;
  }

  if (event === "HARD_COMPLETED") {
    return `Hard Quiz: ${item.reference_type || ""}`;
  }

  if (event === "MEDIUM_COMPLETED") {
    return `Medium Quiz: ${item.reference_type || ""}`;
  }

  if (event === "EASY_COMPLETED") {
    return `Easy Quiz: ${item.reference_type || ""}`;
  }

  if (event === "TOPIC_COMPLETED" && item.reference_type) {
    return `Topic Completed: ${item.reference_type}`;
  }

  if (event === "DAILY_ACTIVE") {
    return "Daily Login";
  }

  return event;
}

exports.getStudentNotifications = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Student access required",
      });
    }

    const userId = req.user.userId;

    /*
    -----------------------------------------
    TEACHER NOTIFICATIONS
    -----------------------------------------
    */
    const teacherNotifications = await pool.query(
      `
      SELECT
        sn.id,
        sn.type,
        sn.title,
        sn.message,
        sn.reference_id,
        sn.is_read,
        sn.created_at,
        t.first_name,
        t.last_name
      FROM student_notifications sn
      LEFT JOIN teachers t
        ON t.id = sn.teacher_id
      WHERE sn.user_id = $1
      `,
      [userId]
    );

    /*
    -----------------------------------------
    XP NOTIFICATIONS
    -----------------------------------------
    */
    const xpNotifications = await pool.query(
      `
      SELECT
        id,
        event_type,
        reference_type,
        source_id,
        xp,
        created_at
      FROM xp_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [userId]
    );

    const teacherData = teacherNotifications.rows.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      message: item.message,
      reference_id: item.reference_id,
      is_read: item.is_read,
      created_at: item.created_at,
      from: item.first_name
        ? `${item.first_name} ${item.last_name}`
        : "Teacher",
    }));

    const xpData = xpNotifications.rows.map((item) => ({
      id: item.id,
      type: "xp_reward",
      title: formatXPLabel(item),
      message: `You earned ${item.xp} XP`,
      reference_id: item.source_id,
      is_read: true,
      created_at: item.created_at,
      from: "SmartLearn",
    }));

    const notifications = [
      ...teacherData,
      ...xpData,
    ].sort(
      (a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    );

    return res.status(200).json({
      success: true,
      count: notifications.length,
      unread_count: teacherData.filter(
        (item) => !item.is_read
      ).length,
      data: notifications,
    });

  } catch (error) {
    console.error("getStudentNotifications error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Student access required",
      });
    }

    const userId = req.user.userId;
    const notificationId = req.params.id;

    await pool.query(
      `
      UPDATE student_notifications
      SET is_read = true
      WHERE
        id = $1
        AND user_id = $2
      `,
      [notificationId, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });

  } catch (error) {
    console.error(
      "markNotificationRead error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.acceptInvite = async (req, res) => {
  const client = await pool.connect();

  try {
    const notificationId = req.params.notificationId;
    const userId = req.user.userId;

    console.log("notificationId:", notificationId);
    console.log("userId:", userId);

    await client.query("BEGIN");

    // Fetch invitation
    const notification = await client.query(
      `
      SELECT *
      FROM student_notifications
      WHERE
        id = $1
        AND user_id = $2
        AND type = 'study_room_invite'
      FOR UPDATE
      `,
      [notificationId, userId]
    );

    if (notification.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Invitation not found",
      });
    }

    const invite = notification.rows[0];

    if (invite.status === "accepted") {
      await client.query("ROLLBACK");

      return res.status(200).json({
        success: true,
        message: "Invitation already accepted",
      });
    }

    if (invite.status === "rejected") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Invitation already rejected",
      });
    }

    // Check room exists
    const room = await client.query(
      `
      SELECT id,is_active,max_learners
      FROM study_rooms
      WHERE id=$1
      `,
      [invite.reference_id]
    );

    if (room.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (!room.rows[0].is_active) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Room is no longer active",
      });
    }

    // Check room capacity
    const count = await client.query(
      `
      SELECT COUNT(*)::int AS learners
      FROM room_participants
      WHERE room_id=$1
      `,
      [invite.reference_id]
    );

    if (
      room.rows[0].max_learners &&
      count.rows[0].learners >= room.rows[0].max_learners
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Room is full",
      });
    }

    // Already participant?
    const exists = await client.query(
      `
      SELECT 1
      FROM room_participants
      WHERE room_id=$1
      AND user_id=$2
      `,
      [invite.reference_id, userId]
    );

    if (exists.rows.length === 0) {
      await client.query(
        `
        INSERT INTO room_participants
        (
          room_id,
          user_id
        )
        VALUES
        (
          $1,
          $2
        )
        `,
        [invite.reference_id, userId]
      );
    }

    // Mark notification accepted
    await client.query(
      `
      UPDATE student_notifications
      SET
        status='accepted',
        is_read=true,
        updated_at=NOW()
      WHERE id=$1
      `,
      [notificationId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Joined successfully",
      roomId: invite.reference_id,
    });

  } catch (err) {

    await client.query("ROLLBACK");

    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Failed to accept invitation",
    });

  } finally {

    client.release();

  }
};

exports.rejectInvite = async (req, res) => {
  const client = await pool.connect();

  try {
    const notificationId = req.params.notificationId;
    const userId = req.user.userId;

    await client.query("BEGIN");

    const notification = await client.query(
      `
      SELECT *
      FROM student_notifications
      WHERE
        id=$1
        AND user_id=$2
        AND type='study_room_invite'
      FOR UPDATE
      `,
      [notificationId, userId]
    );

    if (notification.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Invitation not found",
      });
    }

    const invite = notification.rows[0];

    if (invite.status === "accepted") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Invitation already accepted",
      });
    }

    if (invite.status === "rejected") {
      await client.query("ROLLBACK");

      return res.status(200).json({
        success: true,
        message: "Invitation already rejected",
      });
    }

    await client.query(
      `
      UPDATE student_notifications
      SET
        status='rejected',
        is_read=true,
        updated_at=NOW()
      WHERE id=$1
      `,
      [notificationId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Invitation rejected",
    });

  } catch (err) {

    await client.query("ROLLBACK");

    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Failed to reject invitation",
    });

  } finally {

    client.release();

  }
};