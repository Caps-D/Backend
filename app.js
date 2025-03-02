require('dotenv').config();
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const generateToken = (user) => {
    return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' }); // 토큰 유효기간 7일
};

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
            const [existingData] = await connection.query(
                `SELECT * FROM user_data WHERE user_id = ?`, 
                [user.id]
            );
        
            if (existingData.length === 0) {
                // ✅ 최초 로그인 시에만 기본 데이터 삽입
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user.id, 1, 0, '기본 운동', 10, 3, 0, 'unknown', null, null, 0]
                );
        
                console.log("✅ `user_data`에 기본 정보 삽입 완료");
            }
            console.log("사용자 정보 저장 완료:", result);
        } finally {
            connection.release();
        }
        const token = generateToken({ id: user.id });

        res.json({
            message: '로그인 성공',
            token,
        });


    } catch (error) {
        console.error("카카오 로그인 오류 발생:", error);
        console.error("오류 응답 데이터:", error.response?.data || "응답 없음");
        console.error("오류 메시지:", error.message);

        res.status(400).json({ 
            error: '카카오 로그인 실패', 
            details: error.response?.data || error.message 
        });
    }
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
            const [existingData] = await connection.query(
                `SELECT * FROM user_data WHERE user_id = ?`, 
                [user.id]
            );
        
            if (existingData.length === 0) {
                // ✅ 최초 로그인 시에만 기본 데이터 삽입
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user.id, 1, 0, '기본 운동', 10, 3, 0, 'unknown', null, null, 0]
                );
                
        
                console.log("✅ `user_data`에 기본 정보 삽입 완료");
            }
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
            
            const [existingData] = await connection.query(
                `SELECT * FROM user_data WHERE user_id = ?`, 
                [user.id]
            );
        
            if (existingData.length === 0) {
                // ✅ 최초 로그인 시에만 기본 데이터 삽입
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user.id, 1, 0, '기본 운동', 10, 3, 0, 'unknown', null, null, 0]
                );
        
                console.log("✅ `user_data`에 기본 정보 삽입 완료");
            }
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

// MainData = {
//     level: number;
//     coin: number;
//     targetExercise: string;
//     targetcount: number;
//     targetSet: number;
//     targetCheck: number;
//     character: {
//         gender: string;
//         top: string | null;
//         pants: string | null;
//         state: number | null;
//     };
// };


const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: '인증 토큰이 없습니다.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
};

app.get('/main', authenticate, async (req, res) => {
    const userId = req.user.id;

    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.query(
            `SELECT level, coin, targetExercise, targetcount, targetSet, targetCheck, 
                    gender, top, pants, state 
             FROM user_data 
             WHERE user_id = ?`, 
            [userId]
        );
        connection.release();

        if (rows.length === 0) {
            return res.status(404).json({ error: '사용자 데이터가 없습니다.' });
        }

        const userData = rows[0];
        

        const MainData= {
            level: userData.level,
            coin: userData.coin,
            targetExercise: userData.targetExercise,
            targetcount: userData.targetcount,
            targetSet: userData.targetSet,
            targetCheck: userData.targetCheck,
            character: {
                gender: userData.gender,
                top: userData.top,
                pants: userData.pants,
                state: userData.state,
            },
        };

        res.json(MainData);

    } catch (error) {
        console.error("사용자 데이터 조회 오류:", error);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 친구 추가
app.post('/addFriend', authenticate, async (req, res) => {
    const { friendNickname } = req.body;
    const userId = req.user.id; // 현재 로그인한 사용자 ID

    if (!friendNickname) {
        return res.status(400).json({ error: '친구 닉네임을 입력하세요.' });
    }

    const connection = await pool.getConnection();
    try {
        // 1️⃣ 친구의 user_id 찾기
        const [friendData] = await connection.query(
            `SELECT id, nickname FROM users WHERE nickname = ?`,
            [friendNickname]
        );

        if (friendData.length === 0) {
            return res.status(404).json({ error: '해당 닉네임을 가진 사용자가 없습니다.' });
        }

        const friendId = friendData[0].id;
        const friendNick = friendData[0].nickname;

        // 2️⃣ 이미 친구인지 확인
        const [existingFriend] = await connection.query(
            `SELECT * FROM friends WHERE user_id = ? AND friend_id = ?`,
            [userId, friendId]
        );

        if (existingFriend.length > 0) {
            return res.status(400).json({ error: '이미 친구로 추가된 사용자입니다.' });
        }

        // 3️⃣ 친구 추가
        await connection.query(
            `INSERT INTO friends (user_id, friend_id, friend_nickname) VALUES (?, ?, ?)`,
            [userId, friendId, friendNick]
        );

        res.json({ message: '친구 추가 성공', friend: friendNick });

    } catch (error) {
        console.error('친구 추가 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});

// 친구 목록 가져오기
app.get('/friends', authenticate, async (req, res) => {
    const userId = req.user.id; // 현재 로그인한 사용자 ID

    const connection = await pool.getConnection();
    try {
        // ✅ 내 친구 목록 조회 (내가 추가한 친구들)
        const [friendsList] = await connection.query(
            `SELECT f.friend_id AS id, u.nickname AS nickname, f.status, f.created_at
             FROM friends f
             JOIN users u ON f.friend_id = u.id
             WHERE f.user_id = ?`,
            [userId]
        );

        // ✅ 나를 추가한 친구 목록 조회 (상대방이 나를 추가한 경우)
        const [friendsAddedMe] = await connection.query(
            `SELECT f.user_id AS id, u.nickname AS nickname, f.status, f.created_at
             FROM friends f
             JOIN users u ON f.user_id = u.id
             WHERE f.friend_id = ?`,
            [userId]
        );

        // ✅ 친구 목록 통합 (중복 제거)
        const allFriends = [...friendsList, ...friendsAddedMe].filter(
            (friend, index, self) =>
                index === self.findIndex((f) => f.id === friend.id)
        );

        res.json({ friends: allFriends });

    } catch (error) {
        console.error('친구 목록 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});

// 친구 삭제
app.delete('/removeFriend', authenticate, async (req, res) => {
    const { friendNickname } = req.body;
    const userId = req.user.id; // 현재 로그인한 사용자 ID

    if (!friendNickname) {
        return res.status(400).json({ error: '삭제할 친구의 닉네임을 입력하세요.' });
    }

    const connection = await pool.getConnection();
    try {
        // 1️⃣ 친구의 user_id 찾기
        const [friendData] = await connection.query(
            `SELECT id FROM users WHERE nickname = ?`,
            [friendNickname]
        );

        if (friendData.length === 0) {
            return res.status(404).json({ error: '해당 닉네임을 가진 사용자가 없습니다.' });
        }

        const friendId = friendData[0].id;

        // 2️⃣ 친구 관계 삭제 (내가 추가한 친구 or 상대가 나를 추가한 경우)
        const [deleteResult] = await connection.query(
            `DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
            [userId, friendId, friendId, userId]
        );

        if (deleteResult.affectedRows === 0) {
            return res.status(400).json({ error: '해당 사용자는 친구 목록에 없습니다.' });
        }

        res.json({ message: '친구 삭제 성공', friend: friendNickname });

    } catch (error) {
        console.error('친구 삭제 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});

// 서버 시작
app.listen(port, () => {
  console.log(`Server is running on http://34.47.97.192:${port}`);
});

