require('dotenv').config();
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const generateToken = (user) => {
    return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' }); // 토큰 유효기간 7일
};
const cors = require('cors');

const app = express();
const port = 3000;
const pool = require('./db'); // MySQL 연결 파일 가져오기
const cookieParser = require('cookie-parser');

app.use(cors({
    origin: 'http://localhost:5173', 
    credentials: true,               
}));

app.use(express.json());
app.use(cookieParser());

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

    if (!code) {
        return res.status(400).json({ error: '인가 코드가 없습니다.' });
    }

    try {
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

        const userResponse = await axios.get('https://kapi.kakao.com/v2/user/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const user = {
            id: userResponse.data.id.toString(),
            email: userResponse.data.kakao_account.email || null,
            nickname: userResponse.data.kakao_account.profile.nickname,
            provider: 'kakao',
        };

        const connection = await pool.getConnection();
        let redirectPath = '/main';
        try {
            // 👇 users 테이블에서 해당 사용자 존재 여부 확인
            if (user.email) {
                [existingUser] = await connection.query(
                    `SELECT * FROM users WHERE email = ?`,
                    [user.email]
                );
            }
            if (existingUser.length === 0) {
                [existingUser] = await connection.query(
                    `SELECT * FROM users WHERE id = ?`,
                    [user.id]
                );
            }
            if (existingUser.length === 0) {
                // 🔁 존재하지 않으면 users 테이블에 삽입
                await connection.query(
                    `INSERT INTO users (id, email, nickname, provider) VALUES (?, ?, ?, ?)`,
                    [user.id, user.email, user.nickname, user.provider]
                );
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state)
                     VALUES (?, 1, 500, 0, 0, 0, 0, NULL, NULL, NULL, NULL)`,
                    [user.id]
                );
                

                // 👉 이 경우엔 /signup 으로 보냄
                redirectPath = '/signup';
            } else {
                // 🔁 존재하는 유저라면 정보 업데이트
                await connection.query(
                    `UPDATE users SET email = ?, nickname = ? WHERE id = ?`,
                    [user.email, user.nickname, user.id]
                );
            }

            // user_data는 별도 관리 - 있어도 되고 없어도 됨
        } finally {
            connection.release();
        }

        const token = generateToken({ id: user.id });

        res.cookie('token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        });
        const cors = require('cors');

        app.use(cors({
            origin: 'http://34.47.97.192:5173/',  // 프론트엔드 도메인
            credentials: true,  // 쿠키가 전송되도록 설정
        }));

        // 👉 조건에 따라 리디렉션
        res.redirect(`http://34.47.97.192:5173${redirectPath}`);

    } catch (error) {
        console.error("카카오 로그인 오류:", error);
        res.status(400).json({ error: '카카오 로그인 실패' });
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
        let redirectPath = '/main';
        try {
            const [existingUser] = await connection.query(
                `SELECT * FROM users WHERE id = ?`,
                [user.id]
            );

            if (existingUser.length === 0) {
                await connection.query(
                    `INSERT INTO users (id, email, nickname, provider) VALUES (?, ?, ?, ?)`,
                    [user.id, user.email, user.nickname, user.provider]
                );
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state)
                     VALUES (?, 1, 500, 0, 0, 0, 0, NULL, NULL, NULL, NULL)`,
                    [user.id]
                );
                
                redirectPath = '/signup';
            } else {
                await connection.query(
                    `UPDATE users SET email = ?, nickname = ? WHERE id = ?`,
                    [user.email, user.nickname, user.id]
                );
            }
        } finally {
            connection.release();
        }

        const token = generateToken({ id: user.id });

        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.redirect(`http://34.47.97.192:5173${redirectPath}`);

    } catch (error) {
        console.error('네이버 로그인 오류:', error);
        res.status(400).json({ error: '네이버 로그인 실패' });
    }
});



app.get('/auth/google', (req, res) => {
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}&response_type=code&scope=email%20profile`;
    res.redirect(googleAuthUrl);
});


// **구글 로그인**
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: '인가 코드가 없습니다.' });
    }

    try {
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

        const userResponse = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const user = {
            id: userResponse.data.id,
            email: userResponse.data.email || null,
            nickname: userResponse.data.name,
            provider: 'google',
        };

        const connection = await pool.getConnection();
        let redirectPath = '/main';
        try {
            const [existingUser] = await connection.query(
                `SELECT * FROM users WHERE id = ?`,
                [user.id]
            );

            if (existingUser.length === 0) { 
                await connection.query(
                    `INSERT INTO users (id, nickname, provider) VALUES (?, ?, ?)`,
                    [user.id, user.nickname, user.provider]
                );
                await connection.query(
                    `INSERT INTO user_data (user_id, level, coin, targetExercise, targetcount, targetSet, targetCheck, gender, top, pants, state)
                     VALUES (?, 1, 500, 0, 0, 0, 0, NULL, NULL, NULL, NULL)`,
                    [user.id]
                );
                
                redirectPath = '/signup';
            } else {
                await connection.query(
                    `UPDATE users SET email = ?, nickname = ? WHERE id = ?`,
                    [user.email, user.nickname, user.id]
                );
            }
        } finally {
            connection.release();
        }

        const token = generateToken({ id: user.id });
        res.cookie('token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.redirect(`http://34.47.97.192:5173${redirectPath}`);

    } catch (error) {
        console.error("구글 로그인 오류:", error);
        res.status(400).json({ error: '구글 로그인 실패' });
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
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: '인증 토큰이 X' });
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

        const [existingFriend] = await connection.query(
            `SELECT * FROM friends WHERE user_id = ? AND friend_id = ?`,
            [userId, friendId]
        );

        if (existingFriend.length > 0) {
            return res.status(400).json({ error: '이미 친구로 추가된 사용자입니다.' });
        }

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
    const userId = req.user.id;

    const connection = await pool.getConnection();
    try {
        // 내가 추가한 친구 목록 조회
        const [friendsList] = await connection.query(
            `SELECT u.nickname, ud.level
             FROM friends f
             JOIN users u ON f.friend_id = u.id
             JOIN user_data ud ON ud.user_id = u.id
             WHERE f.user_id = ?`,
            [userId]
        );

        // 나를 친구로 추가한 사람들 조회
        const [friendsAddedMe] = await connection.query(
            `SELECT u.nickname, ud.level
             FROM friends f
             JOIN users u ON f.user_id = u.id
             JOIN user_data ud ON ud.user_id = u.id
             WHERE f.friend_id = ?`,
            [userId]
        );

        // 닉네임 + 레벨 중복 제거
        const allFriends = [...friendsList, ...friendsAddedMe].filter(
            (friend, index, self) =>
                index === self.findIndex((f) => f.nickname === friend.nickname)
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
    const userId = req.user.id;

    if (!friendNickname) {
        return res.status(400).json({ error: '삭제할 친구의 닉네임을 입력하세요.' });
    }

    const connection = await pool.getConnection();
    try {
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

// 성별추가
app.post('/signup', authenticate, async (req, res) => {
    const userId = req.user.id;
    const { gender, nickname } = req.body;

    // ✅ 유효성 검사
    if (!gender || !['male', 'female', 'unknown'].includes(gender)) {
        return res.status(400).json({ error: '유효한 성별을 입력하세요. (male, female, unknown)' });
    }

    if (!nickname || nickname.trim().length < 1) {
        return res.status(400).json({ error: '닉네임을 입력하세요.' });
    }

    const connection = await pool.getConnection();
    try {
        const [result] = await connection.query(
            `UPDATE users SET gender = ?, nickname = ? WHERE id = ?`,
            [gender, nickname, userId]
        );
        const [result2] = await connection.query(
            `UPDATE user_data SET gender = ? WHERE id = ?`,
            [gender, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '해당 사용자를 찾을 수 없습니다.' });
        }

        res.json({ message: '성별 및 닉네임이 업데이트되었습니다.', gender, nickname });
    } catch (error) {
        console.error('성별/닉네임 업데이트 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    } finally {
        connection.release();
    }
});


// 서버 시작
app.listen(port, () => {
  console.log(`Server is running on http://34.47.97.192:${port}`);
});

