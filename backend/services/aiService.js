const aiQueue = require("../queues/aiQueue");

exports.askAI = async ({ roomId, userId, prompt, share }) => {
  await aiQueue.add("ai-job", {
    roomId,
    userId,
    prompt,
    share
  });

  return { message: "Processing..." };
};