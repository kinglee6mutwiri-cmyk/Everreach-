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

  const user = await db.prepare(
    "SELECT email, role, status FROM users WHERE email = ?"
  ).bind(session.email).first();

  if (!user || user.status !== "active") {
    await db.prepare(
      "DELETE FROM sessions WHERE token_hash = ?"
    ).bind(hash).run();
    return null;
  }

  return user;
}

async function requireAdmin(request, db) {
  const user = await getUser(request, db);

  if (!user) {
    return {
      authorized: false,
      response: json({error:"Authentication required."},401)
    };
  }

  if (user.role !== "admin") {
    return {
      authorized: false,
      response: json({error:"Admin access required."},403)
    };
  }

  return {authorized:true,user};
}

async function logActivity(db, actorEmail, targetEmail, eventType, details = null) {
  try {
    await db.prepare(
      "INSERT INTO activity_logs (actor_email, target_email, event_type, details, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      actorEmail || null,
      targetEmail || null,
      eventType,
      details,
      new Date().toISOString()
    ).run();
  } catch (error) {
    console.error("Activity logging failed:", error);
  }
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

            if (body.ageConfirmed !== true)
                return json({error:"You must confirm that you are at least 18 years old."},400);

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

    if (path === "/api/company/register" && request.method === "POST") {
    try {
      const body = await request.json();

      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const legalName = String(body.legalName || "").trim();
      const displayName = String(body.displayName || "").trim();
      const registrationNumber = String(body.registrationNumber || "").trim();
      const countryCode = String(body.countryCode || "").trim().toUpperCase();
      const baseCurrency = String(body.baseCurrency || "").trim().toUpperCase();
      const website = String(body.website || "").trim();
      const contactPhone = String(body.contactPhone || "").trim();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return json({error:"Enter a valid owner email address."},400);

      if (password.length < 8 || password.length > 128)
        return json({error:"Password must contain 8 to 128 characters."},400);

      if (body.ageConfirmed !== true)
        return json({error:"You must confirm that you are at least 18 years old."},400);

      if (!legalName || legalName.length > 180)
        return json({error:"Enter a valid legal company name."},400);

      if (!displayName || displayName.length > 120)
        return json({error:"Enter a valid business display name."},400);

      if (!/^[A-Z]{2}$/.test(countryCode))
        return json({error:"Enter a valid two-letter country code."},400);

      if (!/^[A-Z]{3}$/.test(baseCurrency))
        return json({error:"Enter a valid three-letter currency code."},400);

      if (registrationNumber.length > 100 || contactPhone.length > 40)
        return json({error:"Registration number or phone number is too long."},400);

      if (website) {
        try {
          const parsedWebsite = new URL(website);
          if (!["http:", "https:"].includes(parsedWebsite.protocol))
            throw new Error("Invalid protocol");
        } catch {
          return json({error:"Enter a valid website URL beginning with https:// or http://."},400);
        }
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltText = Array.from(
        salt,
        b => b.toString(16).padStart(2,"0")
      ).join("");

      const passwordHash = await hashPassword(password,salt);
      const now = new Date().toISOString();

      await db.batch([
        db.prepare(
          "INSERT INTO users (email,password_hash,role,created_at,status) VALUES (?,?,?,?,?)"
        ).bind(
          email,
          saltText + ":" + passwordHash,
          "company",
          now,
          "active"
        ),

        db.prepare(
          `INSERT INTO companies (
            owner_email,legal_name,display_name,registration_number,
            country_code,base_currency,website,contact_phone,
            verification_status,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          email,
          legalName,
          displayName,
          registrationNumber || null,
          countryCode,
          baseCurrency,
          website || null,
          contactPhone || null,
          "pending",
          now,
          now
        ),

        db.prepare(
          `INSERT INTO company_wallets (
            company_id,currency,created_at,updated_at
          )
          SELECT id,base_currency,?,?
          FROM companies
          WHERE owner_email = ?`
        ).bind(now,now,email)
      ]);

      await logActivity(
        db,
        email,
        email,
        "company_registration",
        "Company registered and submitted for administrator approval"
      );

      return json({
        ok:true,
        message:"Company registration received. Your account is awaiting administrator approval.",
        verificationStatus:"pending"
      },201);

    } catch (error) {
      if (String(error.message).toLowerCase().includes("unique"))
        return json({error:"This email is already registered."},409);

      console.error("Company registration failed:",error);
      return json({error:"Company registration failed. Please try again."},500);
    }
  }

  if (path === "/api/login" && request.method === "POST") {
        try {
            const body = await request.json();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");

            const user = await db.prepare(
                "SELECT email,password_hash,role,status FROM users WHERE email = ?"
            ).bind(email).first();

            if (!user) {

              await logActivity(db, email, email, "login_failed", "Account not found");

              return json({error:"Incorrect email or password."},401);

            }

    if (user.status !== "active") {

      await logActivity(db, email, email, "login_blocked", "Account suspended");

      return json({error:"Your account is suspended. Contact support."},403);

    }

            const parts = user.password_hash.split(":");
            if (parts.length !== 2)
                return json({error:"Account password format is invalid."},500);

            const salt = new Uint8Array(
                parts[0].match(/.{2}/g).map(v => parseInt(v,16))
            );
            const actual = await hashPassword(password,salt);

            if (actual !== parts[1]) {

              await logActivity(db, email, email, "login_failed", "Incorrect password");

              return json({error:"Incorrect email or password."},401);

            }

            if (user.role === "company") {
        const company = await db.prepare(
            "SELECT verification_status FROM companies WHERE owner_email = ?"
        ).bind(email).first();

        if (!company || company.verification_status !== "approved") {
            const status = company?.verification_status || "missing";
            const messages = {
                pending: "Your company application is awaiting administrator approval.",
                rejected: "Your company application was rejected. Please contact support.",
                suspended: "Your company account is suspended. Please contact support.",
                missing: "Company profile not found. Please contact support."
            };

            await logActivity(
                db,
                email,
                email,
                "company_login_blocked",
                "Company login blocked: " + status
            );

            return json({
                error: messages[status] || "Your company account is not approved."
            },403);
        }
    }

    const value = token();
            const tokenHash = await digest(value);
            const expires = Math.floor(Date.now()/1000) + SESSION_SECONDS;

            await db.prepare(
                "INSERT INTO sessions (token_hash,email,expires_at) VALUES (?,?,?)"
            ).bind(tokenHash,email,expires).run();

    await db.prepare(
      "UPDATE users SET last_login = ? WHERE email = ?"
    ).bind(new Date().toISOString(),email).run();
    await logActivity(db, email, email, "login_success", "Successful login");

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


  if (path === "/api/admin/companies" && request.method === "GET") {
    try {
      const access = await requireAdmin(request, db);
      if (!access.authorized) return access.response;

      const status = new URL(request.url).searchParams.get("status") || "pending";

      if (!["pending", "approved", "rejected", "suspended"].includes(status)) {
        return json({error:"Invalid company status."},400);
      }

      const result = await db.prepare(`
        SELECT
          c.id,
          c.owner_email,
          c.legal_name,
          c.display_name,
          c.registration_number,
          c.country_code,
          c.base_currency,
          c.website,
          c.contact_phone,
          c.verification_status,
          c.rejection_reason,
          c.created_at,
          c.reviewed_by,
          c.reviewed_at,
          u.status AS account_status
        FROM companies c
        JOIN users u ON u.email = c.owner_email
        WHERE c.verification_status = ?
          AND (? != 'approved' OR u.status = 'active')
        ORDER BY c.created_at DESC
        LIMIT 200
      `).bind(status,status).all();

      return json({
        ok:true,
        companies:result.results || [],
        count:(result.results || []).length
      });
    } catch (error) {
      console.error(error);
      return json({error:"Could not retrieve company applications."},500);
    }
  }

  if (path === "/api/admin/companies/approve" && request.method === "POST") {
    try {
      const access = await requireAdmin(request, db);
      if (!access.authorized) return access.response;

      const body = await request.json();
      const companyId = Number(body.companyId);

      if (!Number.isSafeInteger(companyId) || companyId < 1) {
        return json({error:"A valid company ID is required."},400);
      }

      const company = await db.prepare(
        "SELECT id, owner_email, verification_status FROM companies WHERE id = ?"
      ).bind(companyId).first();

      if (!company) return json({error:"Company application not found."},404);

      if (company.verification_status !== "pending") {
        return json({error:"Only pending applications can be approved."},409);
      }

      const now = new Date().toISOString();

      const result = await db.prepare(`
        UPDATE companies
        SET verification_status = 'approved',
            rejection_reason = NULL,
            reviewed_by = ?,
            reviewed_at = ?,
            updated_at = ?
        WHERE id = ? AND verification_status = 'pending'
      `).bind(access.user.email,now,now,companyId).run();

      if (!result.meta || result.meta.changes !== 1) {
        return json({error:"Application changed. Refresh and try again."},409);
      }

      await logActivity(
        db,
        access.user.email,
        company.owner_email,
        "company_approved",
        "Administrator approved company application"
      );

      return json({ok:true,message:"Company application approved."});
    } catch (error) {
      console.error(error);
      return json({error:"Could not approve company application."},500);
    }
  }

  if (path === "/api/admin/companies/reject" && request.method === "POST") {
    try {
      const access = await requireAdmin(request, db);
      if (!access.authorized) return access.response;

      const body = await request.json();
      const companyId = Number(body.companyId);
      const reason = String(body.reason || "").trim();

      if (!Number.isSafeInteger(companyId) || companyId < 1) {
        return json({error:"A valid company ID is required."},400);
      }

      if (reason.length < 5 || reason.length > 500) {
        return json({error:"Rejection reason must contain 5 to 500 characters."},400);
      }

      const company = await db.prepare(
        "SELECT id, owner_email, verification_status FROM companies WHERE id = ?"
      ).bind(companyId).first();

      if (!company) return json({error:"Company application not found."},404);

      if (company.verification_status !== "pending") {
        return json({error:"Only pending applications can be rejected."},409);
      }

      const now = new Date().toISOString();

      const result = await db.prepare(`
        UPDATE companies
        SET verification_status = 'rejected',
            rejection_reason = ?,
            reviewed_by = ?,
            reviewed_at = ?,
            updated_at = ?
        WHERE id = ? AND verification_status = 'pending'
      `).bind(reason,access.user.email,now,now,companyId).run();

      if (!result.meta || result.meta.changes !== 1) {
        return json({error:"Application changed. Refresh and try again."},409);
      }

      await logActivity(
        db,
        access.user.email,
        company.owner_email,
        "company_rejected",
        "Company application rejected: " + reason
      );

      return json({ok:true,message:"Company application rejected."});
    } catch (error) {
      console.error(error);
      return json({error:"Could not reject company application."},500);
    }
  }

  if (path === "/api/admin/users" && request.method === "GET") {
    try {
      const access = await requireAdmin(request, db);
      if (!access.authorized) return access.response;

      const result = await db.prepare(
        "SELECT email, role, status, created_at, last_login FROM users ORDER BY created_at DESC LIMIT 200"
      ).all();

      return json({
        ok:true,
        users:result.results || [],
        count:(result.results || []).length
      });
    } catch (error) {
      console.error(error);
      return json({error:"Could not retrieve users."},500);
    }
  }

  if (path === "/api/admin/users/suspend" && request.method === "POST") {
  try {
    const access = await requireAdmin(request, db);
    if (!access.authorized) return access.response;

    const body = await request.json();
    const email = typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

    if (!email) return json({error:"User email is required."},400);

    const target = await db.prepare(
      "SELECT email, role FROM users WHERE email = ?"
    ).bind(email).first();

    if (!target) return json({error:"User not found."},404);

    if (target.role === "admin") {
      return json({error:"Administrator accounts cannot be suspended."},403);
    }

    await db.prepare(
      "UPDATE users SET status = 'suspended' WHERE email = ?"
    ).bind(email).run();

    await db.prepare(
      "DELETE FROM sessions WHERE email = ?"
    ).bind(email).run();

      await logActivity(db, access.user.email, email, "user_suspended", "Administrator suspended user account");
    return json({ok:true,message:"User account suspended."});
  } catch (error) {
    console.error(error);
    return json({error:"Could not suspend account."},500);
  }
}

if (path === "/api/admin/users/unsuspend" && request.method === "POST") {
  try {
    const access = await requireAdmin(request, db);
    if (!access.authorized) return access.response;

    const body = await request.json();
    const email = typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

    if (!email) return json({error:"User email is required."},400);

    const result = await db.prepare(
      "UPDATE users SET status = 'active' WHERE email = ? AND status = 'suspended'"
    ).bind(email).run();

    if (!result.meta || result.meta.changes === 0) {
      return json({error:"Suspended user not found or account is already active."},404);
    }

      await logActivity(db, access.user.email, email, "user_reactivated", "Administrator reactivated user account");
    return json({ok:true,message:"User account reactivated."});
  } catch (error) {
    console.error(error);
    return json({error:"Could not reactivate account."},500);
  }
}

if (path === "/api/admin/activity" && request.method === "GET") {
  try {
    const access = await requireAdmin(request, db);
    if (!access.authorized) return access.response;

    const result = await db.prepare(
      "SELECT id, actor_email, target_email, event_type, details, created_at FROM activity_logs ORDER BY created_at DESC, id DESC LIMIT 100"
    ).all();

    return json({
      ok:true,
      activities:result.results || [],
      count:(result.results || []).length
    });
  } catch (error) {
    console.error(error);
    return json({error:"Could not retrieve activity logs."},500);
  }
}

if (path === "/api/admin/me" && request.method === "GET") {
    try {
      const access = await requireAdmin(request, db);
      if (!access.authorized) return access.response;

      return json({
        ok:true,
        admin:{
          email:access.user.email,
          role:access.user.role
        }
      });
    } catch (error) {
      console.error(error);
      return json({error:"Admin verification failed."},500);
    }
  }

  if (path === "/api/company/me" && request.method === "GET") {
    try {
      const user = await getUser(request, db);

      if (!user || user.role !== "company") {
        return json({error:"Company account access required."},403);
      }

      const result = await db.prepare(
        `SELECT id, legal_name, display_name, registration_number,
                country_code, base_currency, website, contact_phone,
                verification_status, rejection_reason, created_at
         FROM companies
         WHERE owner_email = ?`
      ).bind(user.email).first();

      if (!result) {
        return json({error:"Company profile not found."},404);
      }

      if (result.verification_status !== "approved") {
        const messages = {
          pending: "Your company application is awaiting administrator approval.",
          rejected: "Your company application was rejected. Please contact support.",
          suspended: "Your company account is suspended. Please contact support."
        };

        return json({
          error: messages[result.verification_status] || "Your company account is not approved."
        },403);
      }

      return json({
        ok:true,
        company:result
      });
    } catch (error) {
      console.error("Company profile retrieval failed:",error);
      return json({error:"Could not retrieve company profile."},500);
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
              const sessionHash = await digest(value);
              const session = await db.prepare(
                "SELECT email FROM sessions WHERE token_hash = ?"
              ).bind(sessionHash).first();
              if (session) await logActivity(db, session.email, session.email, "logout_success", "User signed out");
            }
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
            if (url.pathname === "/admin.html") {
        const user = await getUser(request, env.DB);

        if (!user || user.role !== "admin") {
          return Response.redirect(
            new URL("/login.html", request.url), 302
          );
        }
      }

        if (url.pathname === "/company-dashboard.html") {
          const user = await getUser(request, env.DB);

          if (!user || user.role !== "company") {
            return Response.redirect(
              new URL("/login.html", request.url), 302
            );
          }
        const company = await env.DB.prepare(
          "SELECT verification_status FROM companies WHERE owner_email = ?"
        ).bind(user.email).first();

        if (!company || company.verification_status !== "approved") {
          return Response.redirect(
            new URL("/login.html", request.url), 302
          );
        }

        }

      return await env.ASSETS.fetch(request);
        } catch (error) {
            console.error(error);
            return json({error:"Internal server error."},500);
        }
    },

  async scheduled(controller, env, ctx) {
    const cutoff = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();

    try {
      const result = await env.DB.prepare(
        "DELETE FROM activity_logs WHERE created_at < ?"
      ).bind(cutoff).run();

      console.log(
        "Activity cleanup completed. Deleted records:",
        result.meta?.changes || 0
      );
    } catch (error) {
      console.error("Activity cleanup failed:", error);
      throw error;
    }
  }
};
