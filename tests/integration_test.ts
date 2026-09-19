import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";

const rawBaseUrl = Deno.env.get("SUPABASE_FUNCTIONS_URL") ??
  "http://127.0.0.1:54321/functions/v1";
const BASE_URL = rawBaseUrl.replace(/\/+$/, "");

Deno.test(
  "Bot conversation, client creation, and message persistence flow",
  async () => {
    const testUserId = `test-user-${crypto.randomUUID()}`;
    const clientText = "hello";

    // 1. Call POST /userIncubatorId
    const postRes = await fetch(`${BASE_URL}/userIncubatorId`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: testUserId, text: clientText }),
    });

    assertEquals(postRes.status, 200);
    const postData = await postRes.json();

    assertEquals(postData.userId, testUserId);
    assertExists(postData.clientId);
    assertEquals(
      postData.message,
      `Привет, пользователь ${testUserId}! Ты написал: «${clientText}»`,
    );
    assertExists(postData.timestamp);

    // 2. Call GET /clients and verify client list & ordering
    const clientsRes = await fetch(`${BASE_URL}/clients`);
    assertEquals(clientsRes.status, 200);
    const clientsData = await clientsRes.json();
    assert(Array.isArray(clientsData.clients), "clients should be an array");

    const foundClient = clientsData.clients.find(
      (c: { external_user_id: string }) => c.external_user_id === testUserId,
    );
    assertExists(foundClient, "Generated client should be in the clients list");
    assertEquals(foundClient.id, postData.clientId);

    // Check descending order of last_message_at
    for (let i = 0; i < clientsData.clients.length - 1; i++) {
      const t1 = new Date(clientsData.clients[i].last_message_at).getTime();
      const t2 = new Date(clientsData.clients[i + 1].last_message_at).getTime();
      assert(
        t1 >= t2,
        `Clients not ordered by last_message_at descending: ${t1} < ${t2}`,
      );
    }

    // 3. Call GET /messages and verify messages & ordering
    const messagesRes = await fetch(`${BASE_URL}/messages`);
    assertEquals(messagesRes.status, 200);
    const messagesData = await messagesRes.json();
    assert(Array.isArray(messagesData.messages), "messages should be an array");

    const userMessages = messagesData.messages.filter(
      (m: { external_user_id: string }) => m.external_user_id === testUserId,
    );
    assert(
      userMessages.length >= 2,
      `Expected at least 2 messages for user, got ${userMessages.length}`,
    );

    const clientMsg = userMessages.find(
      (m: { direction: string }) => m.direction === "client",
    );
    assertExists(clientMsg, "Expected client message");
    assertEquals(clientMsg.body, clientText);

    const botMsg = userMessages.find(
      (m: { direction: string }) => m.direction === "bot",
    );
    assertExists(botMsg, "Expected bot message");
    assertEquals(botMsg.body, postData.message);

    // 4. Call GET /messages/{external_user_id} and verify only this user's messages are returned
    const filteredRes = await fetch(`${BASE_URL}/messages/${testUserId}`);
    assertEquals(filteredRes.status, 200);
    const filteredData = await filteredRes.json();
    assert(Array.isArray(filteredData.messages), "filtered messages should be an array");
    assertEquals(filteredData.messages.length, userMessages.length);
    assert(
      filteredData.messages.every(
        (m: { external_user_id: string }) => m.external_user_id === testUserId,
      ),
      "All filtered messages must belong to testUserId",
    );
  },
);

Deno.test("Validation tests for bot endpoint", async () => {
  // Missing userId
  const resNoUser = await fetch(`${BASE_URL}/userIncubatorId`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "hello" }),
  });
  assertEquals(resNoUser.status, 400);

  // Missing text
  const resNoText = await fetch(`${BASE_URL}/userIncubatorId`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user-1" }),
  });
  assertEquals(resNoText.status, 400);

  // Empty strings
  const resEmpty = await fetch(`${BASE_URL}/userIncubatorId`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "   ", text: "   " }),
  });
  assertEquals(resEmpty.status, 400);

  // Non-POST request to userIncubatorId returns 405
  const resGetBot = await fetch(`${BASE_URL}/userIncubatorId`, {
    method: "GET",
  });
  assertEquals(resGetBot.status, 405);
});

Deno.test("HTTP method restrictions on read endpoints", async () => {
  // POST to /clients returns 405
  const resPostClients = await fetch(`${BASE_URL}/clients`, {
    method: "POST",
  });
  assertEquals(resPostClients.status, 405);

  // POST to /messages returns 405
  const resPostMessages = await fetch(`${BASE_URL}/messages`, {
    method: "POST",
  });
  assertEquals(resPostMessages.status, 405);
});
