
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");

const app = express();
const PORT = process.env.PORT || 3000;
const scrypt = promisify(crypto.scrypt);

app.use(express.json({limit:"20kb"}));

const DATA_DIR = path.join(__dirname,"data");
const USERS_FILE = path.join(DATA_DIR,"users.json");

fs.mkdirSync(DATA_DIR,{recursive:true});

if(!fs.existsSync(USERS_FILE)){
    fs.writeFileSync(USERS_FILE,"{}");
}

function readUsers(){
    return JSON.parse(fs.readFileSync(USERS_FILE,"utf8"));
}

function saveUsers(users){
    const temp = USERS_FILE + ".tmp";
    fs.writeFileSync(temp,JSON.stringify(users,null,2),{mode:0o600});
    fs.renameSync(temp,USERS_FILE);
}

const sessions = new Map();
const attempts = new Map();

function getCookie(req,name){
    const cookies = (req.headers.cookie || "").split(";");
    for(const cookie of cookies){
        const parts = cookie.trim().split("=");
        if(parts.shift() === name) return parts.join("=");
    }
    return null;
}

function getSession(req){
    const token = getCookie(req,"everreach_session");
    if(!token) return null;

    const session = sessions.get(token);
    if(!session) return null;

    if(session.expires < Date.now()){
        sessions.delete(token);
        return null;
    }

    return session;
}

function setSession(res,email){
    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token,{
        email,
        expires:Date.now() + 7*24*60*60*1000
    });

    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

    res.setHeader("Set-Cookie",
        `everreach_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`
    );
}

function clearSession(req,res){
    const token = getCookie(req,"everreach_session");
    if(token) sessions.delete(token);

    res.setHeader("Set-Cookie",
        "everreach_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    );
}

async function hashPassword(password){
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = await scrypt(password,salt,64);
    return salt + ":" + derived.toString("hex");
}

async function verifyPassword(password,stored){
    const [salt,key] = stored.split(":");
    if(!salt || !key) return false;

    const derived = await scrypt(password,salt,64);
    const original = Buffer.from(key,"hex");

    return original.length === derived.length &&
        crypto.timingSafeEqual(original,derived);
}

function validEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.get("/api/health",(req,res)=>{
    res.json({ok:true,service:"EVERREACH Authentication"});
});

app.post("/api/signup",async(req,res)=>{
    try{
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if(!validEmail(email))
            return res.status(400).json({error:"Enter a valid email address."});

        if(password.length < 8)
            return res.status(400).json({error:"Password must contain at least 8 characters."});

        const users = readUsers();

        if(users[email])
            return res.status(409).json({error:"This email is already registered."});

        users[email] = {
            email,
            passwordHash:await hashPassword(password),
            role:"user",
            createdAt:new Date().toISOString()
        };

        saveUsers(users);
        res.status(201).json({ok:true,message:"Account created. You can now sign in."});

    }catch(error){
        console.error(error);
        res.status(500).json({error:"Account creation failed."});
    }
});

app.post("/api/login",async(req,res)=>{
    try{
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        const now = Date.now();
        const record = attempts.get(email) || {count:0,time:now};

        if(now-record.time > 15*60*1000){
            record.count=0;
            record.time=now;
        }

        if(record.count >= 10)
            return res.status(429).json({error:"Too many attempts. Try again later."});

        const users = readUsers();
        const user = users[email];

        if(!user || !await verifyPassword(password,user.passwordHash)){
            record.count++;
            attempts.set(email,record);
            return res.status(401).json({error:"Incorrect email or password."});
        }

        attempts.delete(email);
        setSession(res,email);

        res.json({
            ok:true,
            message:"Login successful.",
            user:{email:user.email,role:user.role}
        });

    }catch(error){
        console.error(error);
        res.status(500).json({error:"Login failed."});
    }
});

app.get("/api/me",(req,res)=>{
    const session = getSession(req);

    if(!session)
        return res.status(401).json({authenticated:false});

    const users = readUsers();
    const user = users[session.email];

    if(!user)
        return res.status(401).json({authenticated:false});

    res.json({
        authenticated:true,
        user:{email:user.email,role:user.role}
    });
});

app.post("/api/logout",(req,res)=>{
    clearSession(req,res);
    res.json({ok:true,message:"Signed out successfully."});
});

app.listen(PORT,"0.0.0.0",()=>{
    console.log("EVERREACH authentication server running on port "+PORT);
});
