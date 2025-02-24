require('dotenv').config();
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();
const port = 3000;
const pool = require('./db'); // MySQL 연결 파일 가져오기


app.use(express.json());

app.get('/', (req, res) => {
    res.send("hi, we're h4!");
});

app.get('/auth/kakao', (req, res) => {
    const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${process.env.KAKAO_CLIENT_ID}&redirect_uri=${process.env.KAKAO_REDIRECT_URI}&response_type=code`;
    res.redirect(kakaoAuthUrl);
});

/**
 * 2. 카카오 로그인 후, 인가 코드(code)를 받아 백엔드에서 처리
 */
app.get('/auth/kakao/callback', async (req, res) => {
    const { code } = req.query;
    console.log("카카오 인가 코드:", code);

    if (!code) {
        return res.status(400).json({ error: '인가 코드가 없습니다.' });
    }

    try {
        // 1. 카카오 API에서 Access Token 발급
        const tokenResponse = await axios.post('https://kauth.kakao.com/oauth/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: process.env.KAKAO_CLIENT_ID,
                client_secret: process.env.KAKAO_CLIENT_SECRET,
                redirect_uri: process.env.KAKAO_REDIRECT_URI,
                code,
            },
        });

        const accessToken = tokenResponse.data.access_token;
        console.log("카카오 액세스 토큰:", accessToken);

        // 2. Access Token을 사용해 사용자 정보 가져오기
        const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        // 3. 가져온 사용자 정보 객체로 변환
        const user = {
            id: userResponse.data.id.toString(),
            email: userResponse.data.kakao_account.email || null,
            nickname: userResponse.data.kakao_account.profile.nickname,
            provider: 'kakao',
        };

        console.log("카카오 사용자 정보:", user);

        // 4. MySQL 데이터베이스에 사용자 정보 저장
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.query(
                `INSERT INTO users (id, email, nickname, provider) 
                 VALUES (?, ?, ?, ?) 
                 ON DUPLICATE KEY UPDATE email = VALUES(email), nickname = VALUES(nickname)`,
                [user.id, user.email, user.nickname, user.provider]
            );
            console.log("사용자 정보 저장 완료:", result);
        } finally {
            connection.release();
        }



    } catch (error) {
        console.error("카카오 로그인 오류 발생:", error);
        console.error("오류 응답 데이터:", error.response?.data || "응답 없음");
        console.error("오류 메시지:", error.message);

        res.status(400).json({ 
            error: '카카오 로그인 실패', 
            details: error.response?.data || error.message 
        });
    }
    res.redirect('http://34.47.97.192:3000/');
});


app.get('/auth/naver', (req, res) => {
    const state = Math.random().toString(36).substring(2, 15); // CSRF 방지를 위한 상태 값
    const naverAuthUrl = `https://nid.naver.com/oauth2.0/authorize?client_id=${process.env.NAVER_CLIENT_ID}&redirect_uri=${process.env.NAVER_REDIRECT_URI}&response_type=code&state=${state}`;
    res.redirect(naverAuthUrl);
});


// **네이버 로그인**
app.get('/auth/naver/callback', async (req, res) => {
    const { code, state } = req.query;
    try {
        const tokenResponse = await axios.post('https://nid.naver.com/oauth2.0/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: process.env.NAVER_CLIENT_ID,
                client_secret: process.env.NAVER_CLIENT_SECRET,
                redirect_uri: process.env.NAVER_REDIRECT_URI,
                code,
                state,
            },
        });

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://openapi.naver.com/v1/nid/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const user = {
            id: userResponse.data.response.id,
            email: userResponse.data.response.email || null,
            nickname: userResponse.data.response.nickname,
            provider: 'naver',
        };

        const connection = await pool.getConnection();
        try {
            await connection.query(
                `INSERT INTO users (id, email, nickname, provider) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE email = VALUES(email), nickname = VALUES(nickname)`,
                [user.id, user.email, user.nickname, user.provider]
            );
        } finally {
            connection.release();
        }
    } catch (error) {
        res.status(400).json({ error: '네이버 로그인 실패' });
    }
    res.redirect('http://34.47.97.192:3000/');
});

app.get('/auth/google', (req, res) => {
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}&response_type=code&scope=email%20profile`;
    res.redirect(googleAuthUrl);
});


// **구글 로그인**
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    console.log("구글 인가 코드:", code);

    if (!code) {
        return res.status(400).json({ error: '인가 코드가 없습니다.' });
    }

    try {
        // 1. 구글 API에서 Access Token 발급
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: process.env.GOOGLE_REDIRECT_URI,
                code,
            },
        });

        const accessToken = tokenResponse.data.access_token;
        console.log("구글 액세스 토큰:", accessToken);

        // 2. Access Token을 사용해 사용자 정보 가져오기
        const userResponse = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const user = {
            id: userResponse.data.id,
            email: userResponse.data.email || null,
            nickname: userResponse.data.name,
            provider: 'google',
        };

        console.log("구글 사용자 정보:", user);

        // 3. MySQL 데이터베이스에 사용자 정보 저장
        const connection = await pool.getConnection();
        try {
            await connection.query(
                `INSERT INTO users (id, email, nickname, provider) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE email = VALUES(email), nickname = VALUES(nickname)`,
                [user.id, user.email, user.nickname, user.provider]
            );
        } finally {
            connection.release();
        }

        // 4. 클라이언트에 사용자 정보 JSON 응답
        res.redirect('http://34.47.97.192:3000/');

    } catch (error) {
        console.error("구글 로그인 오류 발생:", error);
        console.error("오류 응답 데이터:", error.response?.data || "응답 없음");
        console.error("오류 메시지:", error.message);

        return res.status(400).json({ 
            error: '구글 로그인 실패', 
            details: error.response?.data || error.message 
        });
    }
    
});




// 서버 시작
app.listen(port, () => {
  console.log(`Server is running on http://34.47.97.192:${port}`);
});

