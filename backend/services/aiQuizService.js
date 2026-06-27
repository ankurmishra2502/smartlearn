const pool = require("../config/db");
const { extractVideoId } = require("./youtubelinkService");
const { getYoutubeVideoDetails } = require("./youtubeServices");
//const { getTranscript } = require("./youtubeTranscript");
/**
 * Create AI Topic
 */
exports.createAITopic = async ({
  subject_id,
  title,
  description,
  difficulty,
  youtube_url,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ===========================
    // Validation
    // ===========================

    if (!subject_id) {
      throw new Error("Subject is required.");
    }

    if (!title || !title.trim()) {
      throw new Error("Topic title is required.");
    }

    if (!youtube_url || !youtube_url.trim()) {
      throw new Error("Youtube URL is required.");
    }

    // ===========================
    // Extract Video ID
    // ===========================

    const youtube_video_id = extractVideoId(youtube_url);

    // ===========================
    // Fetch Video Details
    // ===========================

    //const video = await getYoutubeVideoDetails(youtube_video_id);

    //const transcript = await getTranscript(youtube_url);
    // ===========================
    // Generate Order Index
    // ===========================

    const orderResult = await client.query(
      `
      SELECT COALESCE(MAX(order_index),0)+1 AS next_order
      FROM topics
      WHERE subject_id = $1
      `,
      [subject_id]
    );

    const order_index = orderResult.rows[0].next_order;

    // ===========================
    // Create Topic
    // ===========================

    const topicResult = await client.query(
      `
      INSERT INTO topics
      (
          subject_id,
          title,
          description,
          difficulty,
          order_index
      )
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [
        subject_id,
        title.trim(),
        description || "",
        difficulty || "easy",
        order_index,
      ]
    );

    const topic = topicResult.rows[0];

    // ===========================
    // Save Video
    // ===========================

    const videoResult = await client.query(
      `
      INSERT INTO topic_videos
      (
          topic_id,
          youtube_video_id,
          youtube_url,
          duration
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        topic.id,
        youtube_video_id,
        youtube_url,
        100
      ]
    );

    await client.query("COMMIT");

    return {
      topic,
      video: videoResult.rows[0],
    };
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Create AI Topic Error:", err);

    throw err;
  } finally {
    client.release();
  }
};


