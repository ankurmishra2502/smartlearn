const pool = require("../config/db");
const redis = require("../config/redis");

// 🔥 helper
const normalize = (str) => str.trim().toLowerCase();


// 🚀 CREATE ROOM
exports.createRoom = async (req, res) => {
  try {
    const { topic, subject, goals = [], maxLearners = 4, isPrivate = false } = req.body;

    const hostId = req.user?.userId || "test-user";

    const topicNormalized = normalize(topic);

    const room = await pool.query(
      `INSERT INTO study_rooms 
      (topic, topic_normalized, subject, host_id, max_learners, is_private)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *`,
      [topic.trim(), topicNormalized, subject, hostId, maxLearners, isPrivate]
    );

    const roomId = room.rows[0].id;

    // 🔥 insert goals
    for (let g of goals) {
      await pool.query(
        `INSERT INTO session_goals (room_id, goal) VALUES ($1,$2)`,
        [roomId, g]
      );
    }

    // 🔥 host auto-joins
    await pool.query(
      `INSERT INTO room_participants (room_id, user_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [roomId, hostId]
    );

    res.json(room.rows[0]);

  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Topic already exists" });
    }

    console.error(err);
    res.status(500).json({ error: "Create room failed" });
  }
};



// 🚀 GET ROOMS
exports.getRooms = async (req, res) => {
  try {
    const rooms = await pool.query(`
      SELECT r.*, COUNT(p.user_id) as learners
      FROM study_rooms r
      LEFT JOIN room_participants p ON r.id = p.room_id
      WHERE r.is_active = true
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `);

    res.json(rooms.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
};



// 🚀 JOIN ROOM (FULLY CONTROLLED)
exports.joinRoom = async (req, res) => {
  const userId = req.user?.userId || "test-user";
  const roomId = req.params.id;

  try {
    // 1. Check already joined
    const exists = await pool.query(
      `SELECT 1 FROM room_participants
       WHERE room_id=$1 AND user_id=$2`,
      [roomId, userId]
    );

    if (exists.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: "Already joined"
      });
    }

    // 2. Insert
    await pool.query(
      `INSERT INTO room_participants (room_id, user_id)
       VALUES ($1,$2)`,
      [roomId, userId]
    );

    res.json({
      success: true,
      message: "Joined successfully"
    });

  } catch (err) {
    // fallback safety (race condition)
    if (err.code === "23505") {
      return res.json({
        success: true,
        message: "Already joined"
      });
    }

    console.error(err);
    res.status(500).json({ error: "Join failed" });
  }
};



// 🚀 LEAVE ROOM
exports.leaveRoom = async (req, res) => {
  const userId = req.user?.userId || "test-user";
  const roomId = req.params.id;

  try {
    await pool.query(
      `DELETE FROM room_participants WHERE room_id=$1 AND user_id=$2`,
      [roomId, userId]
    );

    res.json({ message: "Left room" });

  } catch (err) {
    res.status(500).json({ error: "Leave failed" });
  }
};



// 🚀 ROOM DETAILS
exports.getRoomDetails = async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.userId; // from auth middleware

  try {
    // 🔥 1. Check room exists
    const roomRes = await pool.query(
      `SELECT * FROM study_rooms WHERE id = $1`,
      [roomId]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomRes.rows[0];

    // 🔥 2. Check if user joined (ACCESS CONTROL)
    const participantCheck = await pool.query(
      `SELECT 1 FROM room_participants 
       WHERE room_id = $1 AND user_id::text = $2`,
      [roomId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({
        error: "You must join the room to view details"
      });
    }

    // 🔥 3. Get host info
    const hostRes = await pool.query(
      `SELECT u.id, u.first_name, us.current_streak
       FROM users u
       LEFT JOIN user_stats us ON us.user_id::text = u.id::text
       WHERE u.id::text = $1`,
      [room.host_id]
    );

    const host = hostRes.rows[0];

    // 🔥 4. Get participants
    const participantsRes = await pool.query(
      `SELECT u.id, u.first_name
       FROM room_participants rp
       LEFT JOIN users u ON rp.user_id::text = u.id::text
       WHERE rp.room_id = $1`,
      [roomId]
    );

    const participants = participantsRes.rows.map(p => ({
      user_id: p.id,
      name: p.first_name,
      is_host: p.id === room.host_id
    }));

    // 🔥 5. Learners count
    const learnersCount = participants.length;

    // 🔥 6. Goals
    const goalsRes = await pool.query(
      `SELECT id, goal FROM session_goals WHERE room_id = $1`,
      [roomId]
    );

    // 🔥 7. AI Feed (READ ONLY)
    const feedRes = await pool.query(
  `SELECT id, host_id, prompt, response, created_at
   FROM host_ai_feed
   WHERE room_id = $1
   ORDER BY created_at DESC`,
  [roomId]
);

 const groupedFeed = {};

feedRes.rows.forEach((chat) => {
  const dateKey = new Date(chat.created_at)
    .toISOString()
    .split("T")[0]; 
  // Example: 2026-05-07

  if (!groupedFeed[dateKey]) {
    groupedFeed[dateKey] = [];
  }

  groupedFeed[dateKey].push(chat);
});


    // 🔥 8. Role
    const role = userId === room.host_id ? "host" : "participant";

    // 🔥 9. Time ago
    const getTimeAgo = (date) => {
      const diff = Math.floor((Date.now() - new Date(date)) / 1000);
      if (diff < 60) return "just started";
      if (diff < 3600) return Math.floor(diff / 60) + " min ago";
      if (diff < 86400) return Math.floor(diff / 3600) + " hrs ago";
      return Math.floor(diff / 86400) + " days ago";
    };

    // 🚀 FINAL RESPONSE
    res.json({
      room: {
        id: room.id,
        topic: room.topic,
        subject: room.subject,
        created_at: room.created_at,
        is_active: room.is_active
      },

      host: {
        id: host?.id,
        name: host?.first_name,
        streak: host?.current_streak || 0
      },

      learners: {
        current: learnersCount,
        max: room.max_learners
      },

      participants,

      user_role: role,

      session: {
        is_live: room.is_active,
        time_ago: getTimeAgo(room.created_at)
      },

      goals: goalsRes.rows,

      // 🔥 IMPORTANT: read-only AI chats
      feed: groupedFeed
    });

  } catch (err) {
    console.error("Room Details Error:", err);
    res.status(500).json({ error: "Failed to fetch room details" });
  }
};



// 🚀 ONLINE USERS (Redis)
exports.getOnlineUsers = async (req, res) => {
  try {
    const roomId = req.params.id;

    const userIds = await redis.smembers(`room:${roomId}:users`);

    if (userIds.length === 0) {
      return res.json({ success: true, users: [] });
    }

    const users = await pool.query(
      `SELECT first_name, last_name FROM users WHERE id = ANY($1::uuid[])`,
      [userIds]
    );

    res.json({
      success: true,
      users: users.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch online users" });
  }
};

exports.getDashboardStats = async (req, res) => {
  try {
    const [roomsRes, subjectsRes, usersOnline] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM study_rooms WHERE is_active = true`
      ),

      pool.query(
        `SELECT COUNT(DISTINCT subject)
         FROM study_rooms
         WHERE is_active = true`
      ),

      redis.scard("online_users")
    ]);

    res.json({
      success: true,
      data: {
        activeRooms: parseInt(roomsRes.rows[0].count),
        subjectsActive: parseInt(subjectsRes.rows[0].count),
        studentsOnline: usersOnline
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard"
    });
  }
};


exports.getDiscoverRooms = async (req, res) => {
  try {
    const {
      search,
      subject,
      class: userClass,
      sort = "recent",
      page = 1,
      limit = 10
    } = req.query;

    // 🔥 NEW: get userId safely
    const userId = req.user.userId;
    console.log("🔍 Discover Rooms - userId:", userId);
    let filters = [`r.is_active = true`, `r.is_private = false`];
    let values = [];
    let idx = 1;

    // 🔍 SEARCH
    if (search) {
      const terms = search.toLowerCase().trim().split(/\s+/);

      const conditions = terms.map((_, i) => `
        (
          r.topic ILIKE $${idx + i}
          OR r.subject ILIKE $${idx + i}
          OR ua.class::text ILIKE $${idx + i}
        )
      `);

      filters.push(`(${conditions.join(" AND ")})`);

      terms.forEach(term => {
        values.push(`%${term}%`);
      });

      idx += terms.length;
    }

    // 🎯 SUBJECT FILTER
    if (subject && subject !== "ALL") {
      filters.push(`LOWER(r.subject) = $${idx}`);
      values.push(subject.toLowerCase());
      idx++;
    }

    // 🎓 CLASS FILTER
    if (userClass) {
      filters.push(`ua.class = $${idx}`);
      values.push(userClass);
      idx++;
    }

    const offset = (page - 1) * limit;

    // 🔥 SORTING
    let orderBy = "r.created_at DESC";
    if (sort === "popular") {
      orderBy = "learners_count DESC, r.created_at DESC";
    }

    // 🔥 IMPORTANT: reserve index for userId
    const userIdx = idx;       // <-- index for userId
    const limitIdx = idx + 1;
    const offsetIdx = idx + 2;

    const query = `
      SELECT 
        r.id,
        r.topic,
        r.subject,
        r.max_learners,
        r.created_at,

        u.id AS host_id,
        u.first_name AS host_name,

        us.current_streak,

        ua.class AS user_class,

        COUNT(DISTINCT rp.user_id) AS learners_count,

        -- 🔥 FIXED: has_joined with proper casting
        CASE 
          WHEN $${userIdx}::text IS NULL THEN false
          WHEN EXISTS (
            SELECT 1 FROM room_participants rp2
            WHERE rp2.room_id = r.id
            AND rp2.user_id::text = $${userIdx}::text
          )
          THEN true
          ELSE false
        END AS has_joined

      FROM study_rooms r

      LEFT JOIN users u 
        ON r.host_id::text = u.id::text

      LEFT JOIN user_stats us 
        ON us.user_id::text = u.id::text

      LEFT JOIN user_academic_details ua 
        ON ua.user_id::text = u.id::text

      LEFT JOIN room_participants rp 
        ON rp.room_id = r.id

      WHERE ${filters.join(" AND ")}

      GROUP BY 
        r.id,
        u.id,
        us.user_id,
        ua.user_id,
        ua.class,
        us.current_streak

      ORDER BY ${orderBy}

      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    // 🔥 IMPORTANT: push values in correct order
    values.push(userId, limit, offset);

    const result = await pool.query(query, values);

    // 🔥 RESPONSE FORMAT
    const formatted = result.rows.map(r => {
      const learners = parseInt(r.learners_count);

      return {
        id: r.id,
        topic: r.topic,
        subject: r.subject,
        class: r.user_class || "N/A",

        learners: {
          current: learners,
          max: r.max_learners
        },

        created_at: r.created_at,

        host: {
          id: r.host_id,
          name: r.host_name,
          streak: r.current_streak || 0
        },

        status: learners >= r.max_learners ? "FULL" : "AVAILABLE",

        is_popular: learners >= 3,

        // 🔥 NEW FIELD
        has_joined: r.has_joined
      };
    });

    res.json({
      success: true,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        count: formatted.length
      },
      data: formatted
    });

  } catch (err) {
    console.error("Discover Rooms Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch rooms"
    });
  }
};

exports.getInviteUsers = async (req, res) => {
  try {
    const roomId = req.params.id;
    const hostId = req.user.userId;

    // Check room exists and requester is host
    const room = await pool.query(
      `
      SELECT id, host_id
      FROM study_rooms
      WHERE id = $1
      `,
      [roomId]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.rows[0].host_id !== hostId) {
      return res.status(403).json({
        success: false,
        message: "Only host can invite learners",
      });
    }

    // Fetch eligible users
    const users = await pool.query(
      `
      SELECT
    u.id,
    u.first_name,
    u.last_name,
    u.profile_picture
FROM users u
WHERE
    u.role = 'student'
    AND u.id::text <> $2
    AND NOT EXISTS (
        SELECT 1
        FROM room_participants rp
        WHERE rp.room_id = $1
          AND rp.user_id = u.id::text
    )
    AND NOT EXISTS (
        SELECT 1
        FROM student_notifications sn
        WHERE sn.reference_id = $1
          AND sn.type = 'study_room_invite'
          AND sn.status = 'pending'
          AND sn.user_id = u.id
    )
ORDER BY
    u.first_name,
    u.last_name;
      `,
      [roomId, hostId]
    );

    return res.status(200).json({
      success: true,
      count: users.rows.length,
      data: users.rows,
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
};



exports.inviteUser = async (req, res) => {
  try {
    const roomId = req.params.id;
    const hostId = req.user.userId;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    // Check room
    const room = await pool.query(
      `
      SELECT id, host_id, topic
      FROM study_rooms
      WHERE id=$1
      `,
      [roomId]
    );

    if (room.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    // Only host can invite
    if (room.rows[0].host_id !== hostId) {
      return res.status(403).json({
        success: false,
        message: "Only host can invite learners",
      });
    }

    // Cannot invite yourself
    if (hostId === userId) {
      return res.status(400).json({
        success: false,
        message: "You cannot invite yourself",
      });
    }

    // Check user exists
    const user = await pool.query(
      `
      SELECT id
      FROM users
      WHERE id=$1
      `,
      [userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Already participant?
    const participant = await pool.query(
      `
      SELECT 1
      FROM room_participants
      WHERE room_id=$1
      AND user_id=$2
      `,
      [roomId, userId]
    );

    if (participant.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User already joined this room",
      });
    }

    // Pending invite exists?
    const pending = await pool.query(
      `
      SELECT 1
      FROM student_notifications
      WHERE
          user_id=$1
      AND reference_id=$2
      AND type='study_room_invite'
      AND status='pending'
      `,
      [userId, roomId]
    );

    if (pending.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invitation already sent",
      });
    }

    // Create notification
await pool.query(
`
INSERT INTO student_notifications
(
    user_id,
    type,
    title,
    message,
    reference_id,
    is_read,
    status
)
VALUES
(
    $1,
    'study_room_invite',
    'Study Room Invitation',
    $2,
    $3,
    false,
    'pending'
)
`,
[
    userId,
    `You have been invited to join "${room.rows[0].topic}" study room.`,
    roomId
]
);

    return res.status(200).json({
      success: true,
      message: "Invitation sent successfully",
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Failed to send invitation",
    });
  }
};