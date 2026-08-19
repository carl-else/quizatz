# Quizatz (Haderach) - A collaborative and live questionaire/polling application

I want to build a collaborative and live questionnaire/polling application called Quizatz. The goal of this application is to allow users to create, share, and participate in quizzes and polls in real-time. Similar to platforms like Kahoot and Mentimeter, Quizatz will focus on providing an engaging and interactive experience for users.

This is also an exercise in building a live-collaboration application, where multiple users can interact with the same quiz or poll simultaneously. The application will support features such as real-time updates and data visualization of results.

The initial version of Quizatz will be angled toward internal company use, with the ability to restrict access to specific email domains. This will allow for a controlled environment where users can create and participate in quizzes and polls without the need for public access.

## Architecture and deployment

I plan to build Quizatz using a modern web application stack. The frontend will be developed using TypeScript and Vue.js for its reactive components and ease of integration with real-time features. It will be a server-less application in that I intend to serve it using GitHub Pages. It will be committed to GitHub and deployed using GitHub Actions for continuous integration and deployment.

The data backend will be powered by [PartyKit](https://docs.partykit.io). It is room-oriented and allows for real-time collaboration, making it a perfect fit for the live interaction features of Quizatz. PartyKit will handle the state management and synchronization between users in real-time. One caveat is that PartyKit deletes rooms after 24 hours of inactivity, which means that quizzes and polls will not be persistent. This is acceptable for the initial version of Quizatz, as it focuses on live interactions rather than long-term data storage.

## Features

- **Quiz Creation**: Users can create quizzes with multiple-choice questions, true/false questions, and open-ended questions. They can also set time limits for each question.

- **Real-Time Participation**: Users can join quizzes and polls in real-time, with their responses being updated live for all participants. This will create an engaging and interactive experience.

- **Results Visualization**: After the quiz or poll ends, results will be displayed in a visually appealing manner, such as bar charts, pie charts, or tag clouds for open-ended questions.

- **Organizers**: The user creating a room/quiz/poll will be the organizer and will have the ability to manage the session, including starting and ending the quiz, as well as moderating responses.

- **User Authentication**: Users can sign in using their Microsoft account to create and manage their quizzes and polls. Names can be displayed during participation, but no personal data will be stored beyond the session. Organizers can choose to allow anonymous participation if they prefer, and can set a password for their room to restrict access and/or limit the allowed email domain of participants.

## User Stories

- **As an organizer**, I want to create a quiz with multiple-choice questions so that I can engage my team in a fun and interactive way.

- **As a quiz creator**, I can set a time limit for each question and see the results in real-time. The time limits can be global for the entire quiz or specific to each user, when he/she starts reading the question.

- **As an organizer**, I can allow anonymous participation in my quiz so that participants can join without needing to have a Microsoft account.

- **As a participant**, I can join a quiz using a unique room code and my Microsoft account, so that I can participate in the quiz without needing to create an account.

- **As a participant**, I can join a quiz using a unique room code anonymously, if the organizer allows it.

- **As a participant**, I want to join a quiz using a unique room code so that I can participate in the quiz without needing to create an account.

- **As an organizer**, I can edit a resulting tag cloud of open-ended questions, merging similar answers by dragging one answer into another, so that the results are more meaningful and easier to interpret. The answer wording kept is the answer dragged to, and the answer wording of the answer dragged from is deleted. The number of votes for the merged answer is the sum of the votes for both answers.

- **As an organizer**, I can set a password for my quiz room to restrict access to only those who have the password, ensuring that only invited participants can join.
