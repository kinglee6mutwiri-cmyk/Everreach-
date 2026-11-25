const SESSION_SECONDS = 604800;

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...headers
        }
    });
}

function token() {
    return Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        b => b.toString(16).padStart(2, "0")
    ).join("");
}

async function digest(value) {
    const result = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
    );
    return Array.from(new Uint8Array(result),
        b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password),
        "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits({
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256"
    }, key, 256);
    return Array.from(new Uint8Array(bits),
        b => b.toString(16).padStart(2, "0")).join("");
}

function cookie(request) {
    const item = (request.headers.get("Cookie") || "")
        .split(";").map(v => v.trim())
        .find(v => v.startsWith("everreach_session="));
    return item ? item.split("=").slice(1).join("=") : null;
}

function sessionCookie(value) {
    return `everreach_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

async function getUser(request, db) {
    const value = cookie(request);
    if (!value) return null;

    const hash = await digest(value);
    const session = await db.prepare(
        "SELECT email, expires_at FROM sessions WHERE token_hash = ?"
    ).bind(hash).first();

    if (!session) return null;

    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
        await db.prepare(
            "DELETE FROM sessions WHERE token_hash = ?"
        ).bind(hash).run();
        return null;
    }

    return db.prepare(
        "SELECT email, role FROM users WHERE email = ?"
    ).bind(session.email).first();
}

async function api(request, env) {
    const path = new URL(request.url).pathname;
    const db = env.DB;

    if (!db) return json({error:"Database binding DB is missing."},500);

    if (path === "/api/health" && request.method === "GET") {
        return json({ok:true,service:"EVERREACH"});
    }

    if (path === "/api/signup" && request.method === "POST") {
        try {
            const body = await request.json();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                return json({error:"Enter a valid email address."},400);

            if (password.length < 8)
                return json({error:"Password must contain at least 8 characters."},400);

            const salt = crypto.getRandomValues(new Uint8Array(16));
            const saltText = Array.from(salt,
                b => b.toString(16).padStart(2,"0")).join("");
            const passwordHash = await hashPassword(password,salt);

            await db.prepare(
                "INSERT INTO users (email,password_hash,role,created_at) VALUES (?,?,?,?)"
            ).bind(
                email,
                saltText + ":" + passwordHash,
                "user",
                new Date().toISOString()
            ).run();

            return json({ok:true,message:"Account created. You can now sign in."},201);
        } catch (error) {
            if (String(error.message).toLowerCase().includes("unique"))
                return json({error:"This email is already registered."},409);
            console.error(error);
            return json({error:"Account creation failed."},500);
        }
    }

    if (path === "/api/login" && request.method === "POST") {
        try {
            const body = await request.json();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");

            const user = await db.prepare(
                "SELECT email,password_hash,role FROM users WHERE email = ?"
            ).bind(email).first();

            if (!user)
                return json({error:"Incorrect email or password."},401);

            const parts = user.password_hash.split(":");
            if (parts.length !== 2)
                return json({error:"Account password format is invalid."},500);

            const salt = new Uint8Array(
                parts[0].match(/.{2}/g).map(v => parseInt(v,16))
            );
            const actual = await hashPassword(password,salt);

            if (actual !== parts[1])
                return json({error:"Incorrect email or password."},401);

            const value = token();
            const tokenHash = await digest(value);
            const expires = Math.floor(Date.now()/1000) + SESSION_SECONDS;

            await db.prepare(
                "INSERT INTO sessions (token_hash,email,expires_at) VALUES (?,?,?)"
            ).bind(tokenHash,email,expires).run();

            return json({
                ok:true,
                message:"Login successful.",
                user:{email:user.email,role:user.role}
            },200,{"Set-Cookie":sessionCookie(value)});
        } catch (error) {
            console.error(error);
            return json({error:"Login failed."},500);
        }
    }

    if (path === "/api/me" && request.method === "GET") {
        try {
            const user = await getUser(request,db);
            if (!user) return json({authenticated:false},401);
            return json({authenticated:true,user});
        } catch (error) {
            console.error(error);
            return json({error:"Session check failed."},500);
        }
    }

    if (path === "/api/logout" && request.method === "POST") {
        try {
            const value = cookie(request);
            if (value) {
                await db.prepare(
                    "DELETE FROM sessions WHERE token_hash = ?"
                ).bind(await digest(value)).run();
            }
            return json({ok:true,message:"Signed out."},200,{
                "Set-Cookie":"everreach_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
            });
        } catch (error) {
            console.error(error);
            return json({error:"Logout failed."},500);
        }
    }

    return json({error:"API route not found."},404);
}

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            if (url.pathname.startsWith("/api/"))
                return await api(request,env);
            return await env.ASSETS.fetch(request);
        } catch (error) {
            console.error(error);
            return json({error:"Internal server error."},500);
        }
    }
};
