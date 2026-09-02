// ▼ 프로필 정보 (아바타 이미지, 아이디, 소개글) — 자유롭게 수정하세요.
const profile = {
  avatar: "images/avatar.jpg",
  username: "select_home",
  bio: "이쁘고 유용한 꿀템만 소개해요❤️"
};

// ▼ 카테고리별 상품 목록 — title(카테고리명)과 items(상품 배열)를 자유롭게 추가/삭제하세요.
// 각 상품: image(이미지 경로/URL), title(상품명), link(클릭 시 이동할 링크)
const categories = [
  {
    title: "💗인기 제품💗",
    items: [
      { image: "images/sample1.jpg", title: "도자드로잉💙 크랙페인트 핵심재료⭐", link: "https://example.com/product1" },
      { image: "images/sample2.jpg", title: "위빙 코스터💗 필수재료⭐", link: "https://example.com/product2" },
      { image: "images/sample3.jpg", title: "위빙 코스터💗 추천 컬러 합사실", link: "https://example.com/product3" },
      { image: "images/sample4.jpg", title: "위빙 코스터💗 초보자 키트", link: "https://example.com/product4" }
    ]
  },
  {
    title: "청소템 | 왕체리 | 푸른자두 | 바나나볼 | 감자보관 | 나노코팅…",
    items: [
      { image: "images/sample5.jpg", title: "욕실청소 고압 스프레이", link: "https://example.com/product5" },
      { image: "images/sample6.jpg", title: "프리미엄 체리 항공직송", link: "https://example.com/product6" },
      { image: "images/sample7.jpg", title: "아랫배 쏙 들어가는 푸른자두", link: "https://example.com/product7" },
      { image: "images/sample8.jpg", title: "감자 장기보관 바나나볼", link: "https://example.com/product8" }
    ]
  }
];
